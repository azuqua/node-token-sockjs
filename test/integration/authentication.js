
var _ = require("lodash"),
	sinon = require("sinon"),
	EventEmitter = require("events").EventEmitter,
	UUID_REGEXP = /[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}/;

module.exports = function(tokenServer, httpClient, TokenSocket, options){

	describe("Authentication tests", function(){

		it("Should allow for custom middleware on the authentication route", function(done){
			var opts = _.extend({}, options);
			opts.method = "GET";
			opts.path = tokenServer.tokenRoute + "?middleware=1";
			httpClient.request(opts, null, function(error, resp){
				assert.notOk(error, "HTTP request did not return error");
				assert.ok(resp, "Response is ok");
				assert.ok(resp.body, "Response body is ok");
				resp.body = JSON.parse(resp.body);
				assert.isObject(resp.body, "Response body is an object");
				assert.ok(resp.body.middleware, "Response has middleware flag");
				done();
			});
		});

		it("Should disallow http token requests that do not pass the authentication function", function(done){
			var opts = _.extend({}, options);
			opts.method = "GET";
			opts.path = tokenServer.tokenRoute;
			httpClient.request(opts, null, function(error, resp){
				assert.notOk(error, "HTTP request did not return http > 400 error");
				assert.ok(resp, "Response is ok");
				assert.ok(resp.body, "Response body is ok");
				resp.body = JSON.parse(resp.body);
				assert.isObject(resp.body, "Response body is an object");
				assert.property(resp.body, "error", "Response has error message");
				assert.equal(resp.body.error, "Forbidden", "Response body has forbidden message");
				done();
			});
		});

		it("Should disallow http requests that do not have the authentication session property", function(done){
			var oldAuth = tokenServer.authentication;
			tokenServer.authentication = "bar";
			
			var opts = _.extend({}, options);
			opts.method = "GET";
			opts.path = tokenServer.tokenRoute;
			httpClient.request(opts, null, function(error, resp){
				assert.notOk(error, "HTTP request did not return http > 400 error");
				assert.ok(resp, "Response is ok");
				assert.ok(resp.body, "Response body is ok");
				resp.body = JSON.parse(resp.body);
				assert.isObject(resp.body, "Response body is an object");
				assert.property(resp.body, "error", "Response has error message");
				assert.equal(resp.body.error, "Forbidden", "Response body has forbidden message");
				
				tokenServer.authentication = oldAuth;
				done();
			});
		});

		it("Should allow the user to authenticate based on session property", function(done){
			var oldAuth = tokenServer.authentication;
			tokenServer.authentication = "foo";
			
			var opts = _.extend({}, options);
			opts.method = "GET";
			opts.path = tokenServer.tokenRoute;
			httpClient.request(opts, null, function(error, resp){
				assert.notOk(error, "HTTP request did not return error");
				assert.ok(resp, "Response is ok");
				assert.ok(resp.body, "Response body is ok");
				resp.body = JSON.parse(resp.body);
				assert.isObject(resp.body, "Response body is an object");
				assert.property(resp.body, "token", "Response has token");

				tokenServer.authentication = oldAuth;
				done();
			});
		});

		it("Should allow for the user to authenticate based on an authentication function", function(done){
			var opts = _.extend({}, options);
			opts.method = "GET";
			opts.path = tokenServer.tokenRoute + "?allow=1";
			httpClient.request(opts, null, function(error, resp){
				assert.notOk(error, "HTTP request did not return error");
				assert.ok(resp, "Response is ok");
				assert.ok(resp.body, "Response body is ok");
				resp.body = JSON.parse(resp.body);
				assert.isObject(resp.body, "Response body is an object");
				assert.property(resp.body, "token", "Response has token");
				assert.match(resp.body.token, UUID_REGEXP, "Response token matches uuid regexp");
				done();
			});
		});

		it("Should attach an auth flag, UUID, and created timestamp on connected sockets", function(done){
			assert.lengthOf(Object.keys(tokenServer._sockets), 0, "Server starts with zero connected sockets");

			var opts = _.extend({}, options);
			opts.method = "GET";
			opts.path = tokenServer.tokenRoute + "?allow=1";
			httpClient.request(opts, null, function(error, resp){
				var token = JSON.parse(resp.body).token;
				assert.ok(token, "Token exists");

				var socket = new TokenSocket();
				tokenServer.socketServer._connection(socket);

				assert.property(socket, "sid", "Socket as UUID");
				assert.property(socket, "created", "Server tracks socket created timestamp");
				assert.isObject(socket.channels, "Socket tracks channels");
				assert.notOk(socket.auth, "Socket does not start in auth state");
				assert.lengthOf(Object.keys(tokenServer._sockets), 1, "Server has one connected socket");
				assert.equal(EventEmitter.listenerCount(socket._emitter, "data"), 1, "Socket on data has one listener");
				assert.equal(EventEmitter.listenerCount(socket._emitter, "close"), 1, "Socket on close has one listener");

				socket._emit("close");
				assert.lengthOf(Object.keys(tokenServer._sockets), 0, "Server ends with zero connected sockets");
				done();
			});
		});

		it("Should allow a socket to connect with a valid token and notify listeners", function(done){
			assert.lengthOf(Object.keys(tokenServer._sockets), 0, "Server starts with zero connected sockets");
			var opts = _.extend({}, options);
			opts.method = "GET";
			opts.path = tokenServer.tokenRoute + "?allow=1";
			var authListener = sinon.spy(function(socket, auth, callback){
				assert.ok(socket, "Socket is ok");
				assert.property(socket, "sid", "Socket has ID");
				assert.property(socket, "auth", "Socket has auth flag in listener");
				assert.deepEqual(socket.auth, auth, "Socket auth is exposed");
				callback();
			});
			tokenServer.on("authentication", authListener);

			httpClient.request(opts, null, function(error, resp){
				var token = JSON.parse(resp.body).token;
				assert.ok(token, "Token exists");

				var socket = new TokenSocket();
				tokenServer.socketServer._connection(socket);
				socket._rpc("auth", { token: token });

				// wait for redis to respond... I should probably mock that...
				defer(function(){
					assert.property(socket, "host", "Socket has host");
					assert.property(socket, "ip", "Socket has IP address");
					assert.property(socket, "ips", "Socket has IP addresses list");
					assert.isTrue(authListener.called, "Auth listener was called");
					assert.lengthOf(socket._frames, 1, "Socket has 1 response frame");

					var responseFrame = JSON.parse(socket._frames.shift());
					assert.ok(responseFrame, "Response frame exists");
					assert.notOk(responseFrame.error, "Response frame doesnt have an error");
					assert.equal(responseFrame.resp, "success", "Response frame has success message");

					socket._emit("close");
					assert.lengthOf(Object.keys(tokenServer._sockets), 0, "Server ends with zero connected sockets");
					tokenServer.removeAllListeners("authentication");
					done();
				});
			});
		});

		it("Should silenty ignore any socket auth requests that don't look correct", function(done){

			var authListener = sinon.spy(function(socket, auth, callback){
				callback();
			});
			tokenServer.on("authentication", authListener);

			var socket = new TokenSocket();
			tokenServer.socketServer._connection(socket);
			socket._rpc("auth", { token: "foo" });

			// wait for redis to respond... I should probably mock that...
			defer(function(){
				assert.isFalse(authListener.called, "Auth listener was not called");
				assert.lengthOf(socket._frames, 0, "Socket has zero response frames");
				assert.isTrue(socket.end.called, "Socket end was called by server");

				assert.lengthOf(Object.keys(tokenServer._sockets), 0, "Server ends with zero connected sockets");
				tokenServer.removeAllListeners("authentication");
				done();
			});
		});

		it("Should disallow a socket to authenticate with a bad token", function(done){

			var authListener = sinon.spy(function(socket, auth, callback){
				callback();
			});
			tokenServer.on("authentication", authListener);

			var socket = new TokenSocket();
			tokenServer.socketServer._connection(socket);
			socket._rpc("auth", { token: "0d5375e1-7f34-48ac-9682-a9546367bf9b" });

			// wait for redis to respond... I should probably mock that...
			defer(function(){
				assert.isFalse(authListener.called, "Auth listener was not called");
				assert.lengthOf(socket._frames, 1, "Socket has 1 response frame");

				var responseFrame = JSON.parse(socket._frames.shift());
				assert.ok(responseFrame, "Response frame exists");
				assert.equal(responseFrame.error, "Token not found", "Response frame has correct error");
				assert.notOk(responseFrame.resp, "Response frame doesnt have response");
				assert.isTrue(socket.end.called, "Socket end was called by server");
				
				assert.lengthOf(Object.keys(tokenServer._sockets), 0, "Server ends with zero connected sockets");
				tokenServer.removeAllListeners("authentication");
				done();
			});
		});

		it("Should disallow unauthenticated sockets from doing anything", function(done){
			var socket = new TokenSocket();
			tokenServer.socketServer._connection(socket);
			socket._rpc("echo", { foo: "bar" });

			// wait for redis to respond... I should probably mock that...
			defer(function(){
				assert.lengthOf(socket._frames, 1, "Socket has 1 response frame");

				var responseFrame = JSON.parse(socket._frames.shift());
				assert.ok(responseFrame, "Response frame exists");
				assert.equal(responseFrame.error, "Forbidden", "Response frame has correct error");
				assert.notOk(responseFrame.resp, "Response frame doesnt have response");
				assert.isTrue(socket.end.called, "Socket end was called by server");
				
				assert.lengthOf(Object.keys(tokenServer._sockets), 0, "Server ends with zero connected sockets");
				done();
			});
		});

	});

};