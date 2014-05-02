<h1>Token Socket Server</h1>
<p>
	A small wrapper around express, sockjs, and redis that provides additional websocket functionality.
</p>
<p>
	<h3>Currently supported</h3>
	<ul>
		<li>Token authentication</li>
		<li>RPC abstraction</li>
		<li>Channel publish-subscribe</li>
	</ul>
</p>
<p>
	<a href="https://github.com/azuqua/jquery-token-sockjs">jQuery Token Sockjs Client</a>
</p>
<h1>Usage</h1>
<pre>
	// in your app.js
	var express = require("express"),
		http = require("http"),
		redis = require("redis"),
		TokenSocketServer = require("node-token-sockjs"),
		sockjs = require("sockjs");

	// handles token operations
	var redisClient = redis.createClient();

	// if you would like to use the pub-sub commands
	var pubsubClient = redis.createClient();

	// create a controller object that will handle rpc commands, usually in a separate file
	var controller = {
		
		// now clients can issue rpc commands for someRPCFunction
		someRPCFunction: function(data, callback){
			somethingAsync(data, function(error, resp){
				if(error)
					callback(error); // the error message will be sent back to the client
				else
					callback(null, resp); // resp will be stringified and sent back
			});
		}

	};

	var app = express();
	var server = http.createServer(app),
		socketServer = sockjs.createServer();

	var socketOptions = {
		prefix: "/sockets",
		socketjs_url: "//cdn.sockjs.org/sockjs-0.3.min.js"
	};
	socketServer.installHandlers(server, socketOptions);

	// wrap the socketServer with the token authentication, etc
	var options = {
		app: app,
		prefix: socketOptions.prefix, // defaults to '/sockets', this must match the client
		tokenRoute: "/something", // defaults to '/socket/token', this must match the client
		redisClient: redisClient,
		socketServer: socketServer,
		socketController: controller
	};

	// if you want to use pub-sub functions
	options.pubsubClient = pubsubClient;

	// you can also add custom middleware on the token route
	options.customMiddleware = function(req, res, next){};

	// there are three options for authenticating users that determine if they will be issued a token

	// if options.authentication is a function then it will be called on each token request with the request object and a callback as parameters
	// the callback must be called with a truthy second parameter for the client to be issued a token
	options.authentication = function(req, callback){
		// query a database, interact with passport, etc
		doSomethingAsync(req.query, function(error, resp){
			if(error)
				callback(error); // no token will be issued
			else if(!resp)
				callback(null, false); // no token will be issued
			else
				callback(null, true);
		});
	};

	// if options.authentication is a string then the server will check the session parameter keyed by options.authentication
	// for example, the server will check for req.session.authenticated to determine if the client will be issued a token
	options.authentication = "authenticated";

	// if options.authentication is undefined the server will default to checking req.session.auth
	
	// note: by default tokens only work once. if the client needs to reconnect it will need to request a new token

	var tokenServer = new TokenSocketServer(options);

	// put a 5 second TTL on all unauthorized sockets
	tockenServer.enableCleanup(5000);

	// get all of the sockets
	var sockets = tokenServer.sockets();

	// list the local channels
	// if you're running this in a distributed environment (with a shared redis host) this will only list the channels for sockets connected to this server instance 
	var channels = tokenServer.channels();

	// iterate over a socket's channels
	sockets[0].channels.forEach(function(channel){
		console.log("Channel: ", channel);
	});

	// all pub-sub commands are usually called from the client, but if you want you can manually change subscriptions on sockets too

	// subscribe a socket to a channel
	tokenServer.subscribe(sockets[0], channels[0]);

	// unsubscribe a socket from a channel
	tokenServer.unsubscribe(sockets[0], channels[0]);

	// to publish a message on a channel
	tokenServer.publish(channels[0], { foo: "bar" });

	// to publish a message on all channels
	tokenServer.broadcast({ foo: "bar" });

	server.listen(process.env.PORT, function(){
		console.log("Server started");
	});

	// remove the TTL on unauthorized sockets
	tokenServer.disableCleanup();

	// close all sockets and unsubscribe from all channels
	tokenServer.shutdown();

</pre>
