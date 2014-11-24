
var mocks = require("./mocks");

module.exports = function(TokenSocketServer){

	var express = require("express"),
		sockjs = require("sockjs"),
		redis = require("redis"),
		http = require("http");

	var redisHost = process.env.REDIS_HOST || "127.0.0.1",
		redisPort = process.env.REDIS_PORT || 6379;

	var redisClient = redis.createClient(redisPort, redisHost),
		pubsubClient = redis.createClient(redisPort, redisHost);

	var app = express(),
		socketServer = sockjs.createServer();

	var server = http.createServer(app),
		port = process.env.PORT || 6072;

	socketServer.installHandlers(server, {
		prefix: "/sockets",
	    sockjs_url: "//cdn.sockjs.org/sockjs-0.3.min.js"
	});

	var tokenServer = new TokenSocketServer(app, redisClient, socketServer, {
		pubsubClient: pubsubClient,
		socketController: {
			echo: function(auth, data, callback){
				callback(null, data);
			}
		},
		authentication: function(req, callback){
			callback(null, req.param("allow"));
		}
	});

	describe("Client interaction tests", function(){

		before(function(done){
			server.listen(port, done);
		});

		after(function(){
			tokenServer.shutdown();
		});

		var options = {
			host: "127.0.0.1",
			port: port,
			authentication: {
				allow: 1
			}
		};

		require("./integration/authentication")(tokenServer, options, mocks);
		require("./integration/rpc")(tokenServer, options, mocks);
		require("./integration/pubsub")(tokenServer, options, mocks);

	});

};