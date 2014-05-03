
var assert = require("chai").assert,
	express = require("express"),
	http = require("http"),
	redis = require("redis"),
	sockjs = require("sockjs"),
	_ = require("underscore"),
	MockClient = require("./mockclient"),
	RestJS = require("restjs"),
	TokenSocketServer = require("../index");

if(RestJS.Rest)
	RestJS = RestJS.Rest;

var app = express(),
	redisClient = redis.createClient(),
	pubsubClient = redis.createClient(),
	socketServer = sockjs.createServer(),
	port = 7890;

var server = http.createServer(app);

socketServer.installHandlers(server, {
	prefix: "/sockets",
    socketjs_url: "//cdn.sockjs.org/sockjs-0.3.min.js"
});

var controller = {
	echo: function(data, callback){
		process.nextTick(function(){
			callback(null, data);
		});
	}
};

var testMiddleware = function(req, res, next){
	if(req.query.middleware)
		res.json(200, { middleware: true });
	else
		next();
};

var tokenAuth = function(req, callback){
	process.nextTick(function(){
		callback(null, req.query.allow);
	});
};

var options = {
	app: app,
	prefix: "/sockets",
	tokenRoute: "/socket/token",
	redisClient: redisClient,
	pubsubClient: pubsubClient,
	socketServer: socketServer,
	socketController: controller,
	customMiddleware: testMiddleware
};


var restClient = new RestJS({ protocol: "http" });
var requestToken = function(route, callback){
	var opts = {
		host: "127.0.0.1",
		port: port,
		method: "GET",
		path: route
	};
	restClient.request(opts, {}, callback);
};

describe("Token Socket Server test suite", function(){

	var tokenServer;

	describe("Token Server setup tests", function(){

		it("Should create socket server without errors", function(){
			tokenServer = new TokenSocketServer(options);
			assert.instanceOf(tokenServer, TokenSocketServer, "Server instantiated correctly");
		});

		it("Should create a token route on the express server", function(){
			var route = _.find(app.routes.get, function(curr){
				return curr.path === options.tokenRoute;
			});	
			assert.isObject(route, "Token route created");
		});

		it("Should add custom middleware to token route", function(){
			var route = _.find(app.routes.get, function(curr){
				return curr.path === options.tokenRoute;
			});
			assert.isArray(route.callbacks, "Route callbacks exist");
			assert.lengthOf(route.callbacks, 2, "Two callbacks exist for token route");
		});

		it("Should proxy the socketController", function(){
			assert.isObject(tokenServer.socketController, "Socket controller found");
			assert.isFunction(tokenServer.socketController.echo, "Echo action found on controller");
		});

		it("Should allow for custom authentication", function(){
			assert.isFunction(tokenServer.authentication, "Custom authentication function found");
		});

		it("Should allow for a TTL on all unauthorized sockets", function(){
			assert.isFunction(tokenServer.enableCleanup, "Server implements function to enable cleanup");
			assert.isFunction(tokenServer.disableCleanup, "Server implements function to disable cleanup");
		});

	});

	describe("Token server integration tests", function(){

		before(function(done){
			server.listen(port, done);
		});

		it("Should allow the server to list all sockets", function(){
			assert.isFunction(tokenServer.sockets, "Server implements sockets function");
			assert.isArray(tokenServer.sockets(), "Server returns array of sockets");
		});

		it("Should disallow invalid token requests", function(done){
			requestToken(options.tokenRoute, function(error, resp){
				assert.isUndefined(error, "Error is undefined");
				assert.equal(resp.statusCode, 400, "Response status code is 400");
				assert.include(resp.body, "Unauthorized", "Response returns unauthorized");
				done();
			});
		});

		it("Should allow valid token requests", function(done){
			requestToken(options.tokenRoute + "?allow=1", function(error, resp){
				assert.isUndefined(error, "Error is undefined");
				assert.equal(resp.statusCode, 200, "Response status code is 200");
				resp.body = JSON.parse(resp.body);
				assert.isObject(resp.body, "Response body is valid JSON");
				assert.hasProperty(resp.body, "token", "Response contains token property");
				assert.isString(resp.body.token, "Response token is string");
			});
		});

		it("Should pass token requests through custom middleware", function(done){
			requestToken(options.tokenRoute + "?middleware=1", function(error, resp){
				assert.isUndefined(error, "Error is undefined");
				assert.equal(resp.statusCode, 200, "Response status code is 200");
				resp.body = JSON.parse(resp.body);
				assert.isObject(resp.body, "Response body is valid JSON");
				assert.hasProperty(resp.body, "middleware", "Response contains middleware property");
			});
		});

		it("Should allow websockets with valid tokens to connect", function(done){
			requestToken(options.tokenRoute + "?allow=1", function(error, resp){
				var token = JSON.parse(resp.body).token;
				var socket = new MockClient("http://127.0.0.1:" + port, token, options.prefix);
				socket.ready(function(error){
					assert.isUndefined(error, "Socket handshake error is undefined");
					socket.end();
					done();
				});
			});
		});

		it("Should pass rpc commands to the socket controller", function(done){
			requestToken(options.tokenRoute + "?allow=1", function(error, resp){
				var token = JSON.parse(resp.body).token;
				var socket = new MockClient("http://127.0.0.1:" + port, token, options.prefix);
				socket.ready(function(error){
					var req = { foo: "bar" };
					socket.rpc("echo", { foo: "bar" }, function(error, resp){
						assert.isUndefined(error, "Echo error is undefined");
						assert.isObject(resp, "Echo response is object");
						assert.deepEqual(resp, req, "Echo response object is the same as the request object");
						socket.end();
						done();
					});
				});
			});
		});

		describe("Publish - subscribe testing", function(){

			var testChannel = "channel",
				testChannel2 = "channel2"
				testData = { foo: "bar" },
				socket;

			before(function(done){
				requestToken(options.tokenRoute + "?allow=1", function(error, resp){
					var token = JSON.parse(resp.body).token;
					socket = new MockClient("http://127.0.0.1:" + port, token, options.prefix);
					socket.ready(function(err){
						done();
					});
				});
			});

			it("Should allow the server to list local channels", function(){
				assert.isFunction(tokenServer.channels, "Server implements channels function");
				assert.isArray(tokenServer.channels(), "Server returns array of channels");
			});

			it("Should allow sockets to subscribe to channels", function(done){
				assert.isFunction(socket.subscribe, "Socket implements subscription function");
				socket.subscribe(testChannel);
				setTimeout(function(){
					assert.include(socket.channels(), testChannel, "Socket channels include testChannel");
					assert.include(tokenServer.channels(), testChannel, "Server channels include testChannel");
					done();
				}, 1000);
			});

			it("Should allow sockets to publish messages on channels", function(done){
				assert.isFunction(socket.publish, "Socket implements publish function");
				socket.publish(testData, testChannel);
				socket.onmessage(function(channel, message){
					assert.equal(channel, testChannel, "Received message on test channel");
					assert.deepEqual(message, testData, "Received test message data");
					socket.onmessage(null);
					done();
				});
			});

			it("Should allow sockets to broadcast messages on all channels", function(done){
				assert.isFunction(socket.broadcast, "Socket implements broadcast function");
				socket.subscribe(testChannel2);
				var i = 0;
				socket.onmessage(function(channel, message){
					i++;
					assert.include(channel, testChannel, "Received message on valid channel");
					assert.deepEqual(testData, message, "Received valid message");
					if(i === 2)
						done();
				});
				socket.broadcast(testData);
			});

			it("Should allow sockets to unsubscribe from channels", function(done){
				assert.isFunction(socket.unsubscribe, "Socket implements unsubscribe function");
				socket.unsubscribe(testChannel2);
				setTimeout(function(){
					assert.notInclude(socket.channels(), testChannel2, "Socket's channel list does not contain second test channel");
					assert.notInclude(tokenServer.channels(), testChannel2, "Server's channel list does not contain second test channel");
					done();
				}, 1000);
			});

			it("Should prevent sockets from receiving messages on channels they're not subscribed to", function(done){
				var channel = null, message = null;
				socket.onmessage(function(_channel, _message){
					channel = _channel;
					message = _message;
				});
				socket.publish(testData, testChannel2);
				setTimeout(function(){
					socket.onmessage(null);
					assert.isNull(channel, "Did not receive message on any channel");
					assert.isNull(message, "Didnot receive any message");
					done();
				}, 3000);
			});

			it("Should allow the server to manually subscribe a socket to a channel", function(done){
				assert.isFunction(tokenServer.subscribe, "Server implements subscribe function");
				assert.lengthOf(tokenServer.sockets(), 1, "Server has one socket");
				var serverSocket = tokenServer.sockets()[0];
				tokenServer.subscribe(serverSocket, testChannel2);
				socket.publish(testChannel2, testData);
				var channel = null, message = null;
				socket.onmessage(function(_channel, _message){
					channel = _channel;
					message = _message;
				});
				setTimeout(function(){
					socket.onmessage(null);
					assert.equal(channel, testChannel2, "Socket received message on correct channel");
					assert.deepEqual(message, testData, "Socket received correct message");
					done();
				}, 2000);
			});

			it("Should allow the server to manually publish a message on a channel", function(done){
				assert.isFunction(tokenServer.publish, "Server implements publish function");
				assert.lengthOf(tokenServer.sockets(), 1, "Server has one socket");
				tokenServer.publish(testChannel2, testData);
				var channel = null, message = null;
				socket.onmessage(function(_channel, _message){
					channel = _channel;
					message = _message;
				});
				setTimeout(function(){
					socket.onmessage(null);
					assert.equal(channel, testChannel2, "Socket received message on correct channel");
					assert.deepEqual(message, testData, "Socket received correct message");
					done();
				}, 2000);
			});

			it("Should allow the server to manually broadcast messages on all channels", function(done){
				assert.isFunction(tokenServer.broadcast, "Server implements broadcast function");
				assert.lengthOf(tokenServer.sockets(), 1, "Server has one socket");
				var i = 0, validChannels = [testChannel, testChannel2];
				socket.onmessage(function(channel, message){
					i++;
					assert.include(validChannels, channel, "Received message on valid channel");
					assert.deepEqual(message, testData, "Received correct message");
					if(i === 2)
						done();
				});
				tokenServer.broadcast(testData);
			});

			it("Should allow the server to manually unsubscribe a socket from a channel", function(done){
				assert.isFunction(tokenServer.unsubscribe, "Server implements unsubscribe function");
				assert.lengthOf(tokenServer.sockets(), 1, "Server has one socket");
				var serverSocket = tokenServer.sockets()[0];
				tokenServer.unsubscribe(serverSocket, testChannel2);
				var channel = null, message = null;
				socket.onmessage(function(_channel, _message){
					channel = _channel;
					message = _message;
				});
				setTimeout(function(){
					socket.onmessage(null);
					assert.isNull(channel, "No message received on any channel");
					assert.isNull(message, "No message received");
					done();
				}, 2000);
				tokenServer.publish(testChannel2, testData);
			});

			it("Should cleanup unused sockets", function(done){
				// TODO finish writing tests for cleanup tests

			});

		});

	});

	describe("Token server shutdown tests", function(){

		it("Should allow users to shut down the server", function(done){
			assert.isFunction(tokenServer.shutdown, "Server implements shutdown function");
			tokenServer.shutdown();
			setTimeout(function(){
				assert.lengthOf(tokenServer.sockets(), 0, "Server has no connected sockets");
				assert.lengthOf(tokenServer.channels(), 0, "Server has no channels");
				done();
			}, 1000);
		});

	});

});

