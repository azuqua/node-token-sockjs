
var _ = require("lodash"),
	sinon = require("sinon");

module.exports = function(tokenServer, httpClient, TokenSocket, options){

	describe("RPC tests", function(){

		var socket, token;

		beforeEach(function(done){
			socket = new TokenSocket();
			var opts = _.extend({}, options);
			opts.method = "GET";
			opts.path = tokenServer.tokenRoute + "?allow=1";
			httpClient.request(opts, null, function(error, resp){
				token = JSON.parse(resp.body).token;
				socket = new TokenSocket();
				tokenServer.socketServer._connection(socket);
				socket._rpc("auth", { token: token });

				// wait for redis to respond... I should probably mock that...
				defer(function(){
					socket._frames.shift();
					done();
				});
			});
		});

		afterEach(function(){
			socket._emit("close");
		});

		it("Should allow authenticated sockets to make rpc to top level actions", function(){
			var data = { foo: "bar" };
			assert.lengthOf(socket._frames, 0, "Socket starts with no outgoing frames");
			socket._rpc("echo", { req: data });
			assert.isTrue(tokenServer.socketController.echo.calledOnce, "Echo was called once");
			assert.lengthOf(socket._frames, 1, "Socket has one outgoing frame");
			assert.isFalse(tokenServer.socketController.nested.echo.called, "Nested echo was not called");
			var responseFrame = JSON.parse(socket._frames.shift());
			assert.notOk(responseFrame.error, "Response does not have error");
			assert.deepEqual(responseFrame.resp, data, "Data equals response for echo");
		});

		it("Should allow authenticated sockets to make rpc calls to nested actions", function(){
			var data = { foo: "bar" };
			assert.lengthOf(socket._frames, 0, "Socket starts with no outgoing frames");
			socket._rpc("nested.echo", { req: data });
			assert.isTrue(tokenServer.socketController.echo.calledOnce, "Outer echo was not called again");
			assert.isTrue(tokenServer.socketController.nested.echo.calledOnce, "Nested echo was called once");
			var responseFrame = JSON.parse(socket._frames.shift());
			assert.notOk(responseFrame.error, "Response does not have error");
			assert.deepEqual(responseFrame.resp, data, "Data equals response for echo");
		});

		it("Should return an error if the requested rpc function is not found", function(){
			var data = { foo: "bar" };
			assert.lengthOf(socket._frames, 0, "Socket starts with no outgoing frames");

			socket._rpc("not.there", { req: data });
			var responseFrame = socket._frames.shift();
			assert.ok(responseFrame, "Response frame exists");
			responseFrame = JSON.parse(responseFrame);
			assert.notOk(responseFrame.resp, "Response frame doesnt have response");
			assert.equal(responseFrame.error, "Function not found", "Response has correct error message");
		});

		it("Should allow the server to make rpc calls to the client", function(){
			var data = { foo: "bar" },
				cmd = "baz";

			assert.lengthOf(socket._frames, 0, "Socket starts with no outgoing frames");

			var rpcCallback = sinon.spy(function(error, resp){
				assert.notOk(error, "Error doesnt exist in rpc callback");
				assert.deepEqual(resp, data, "RPC response equals input data");
			});

			assert.lengthOf(Object.keys(tokenServer._inTransit), 0, "Server inTransit is empty");
			tokenServer.rpc(socket, cmd, data, rpcCallback);
			assert.lengthOf(Object.keys(tokenServer._inTransit), 1, "Server inTransit has one rpc ID");

			var fid = Object.keys(tokenServer._inTransit)[0];

			var socketFrame = socket._frames.shift();
			assert.ok(socketFrame, "Socket frame exists");
			socketFrame = JSON.parse(socketFrame);

			assert.isTrue(socketFrame.internal, "Internal flag exists on socket frame");
			assert.equal(socketFrame.command, "rpc", "Internal rpc command flag is correct");
			assert.isObject(socketFrame.data, "Socket frame has data object");
			assert.equal(socketFrame.data.fid, fid, "Socket frame has correct rpc ID");
			assert.equal(socketFrame.data.command, cmd, "Socket frame has correct internal rpc command");
			assert.deepEqual(socketFrame.data.args, data, "Socket frame has correct rpc args");

			var responseFrame = {
				rpc: "_rpc",
				fid: fid, 
				resp: {
					data: data
				}
			};

			assert.isFalse(rpcCallback.called, "RPC callback has not been called yet");
			socket._emit("data", JSON.stringify(responseFrame));
			assert.isTrue(rpcCallback.called, "RPC callback was called after response");
			assert.lengthOf(Object.keys(tokenServer._inTransit), 0, "Server inTransit is empty");
			assert.lengthOf(socket._frames, 0, "Socket ends with no outgoing frames");
		});

		it("Should work with express route functions", function(){
			var data = { bar: "baz" },
				route = "ping";

			assert.lengthOf(socket._frames, 0, "Socket starts with no outgoing frames");
			socket._rpc(route, { req: data });
			var responseFrame = JSON.parse(socket._frames.shift());
			assert.notOk(responseFrame.error, "Response does not have error");
			assert.equal(responseFrame.resp.bar, data.bar, "Response has correct data");
			assert.isObject(responseFrame.resp._headers, "Response has http headers");
			assert.equal(responseFrame.resp._headers["content-type"], "application/json");
			assert.isNumber(responseFrame.resp._code, "Response has http code");
		});

		it("Should work with nested express route functions", function(){
			var data = { bar: "foo" },
				route = "nested.ping";

			assert.lengthOf(socket._frames, 0, "Socket starts with no outgoing frames");
			socket._rpc(route, { req: data });
			var responseFrame = JSON.parse(socket._frames.shift());
			assert.notOk(responseFrame.error, "Response does not have error");
			assert.equal(responseFrame.resp.bar, data.bar, "Response has correct data");
			assert.isObject(responseFrame.resp._headers, "Response has http headers");
			assert.equal(responseFrame.resp._headers["content-type"], "application/json");
			assert.isNumber(responseFrame.resp._code, "Response has http code");
		});

		it("Should handle ping requests from clients", function(){
			assert.isFunction(tokenServer.socketController._ping, "Server has ping function");
			var expected = { message: "pong" },
				route = "_ping",
				data = {};

			assert.lengthOf(socket._frames, 0, "Socket starts with no outgoing frames");
			socket._rpc(route, { req: data });
			var responseFrame = JSON.parse(socket._frames.shift());
			assert.notOk(responseFrame.error, "Response does not have error");
			assert.deepEqual(responseFrame.resp, expected, "Ping response is correct");
		});

	});

};