
var async = require("async"),
	_ = require("underscore"),
	uuid = require("node-uuid"),
	utils = require("./utils"),
	ALL_CHANNEL = "__all__";

var TokenSocketServer = function(options){
	var self = this;
	self.app = options.app;
	self.prefix = options.prefix || "/sockets";
	self.tokenRoute = options.tokenRoute || "/socket/token";
	self.redisClient = options.redisClient;
	self.socketServer = options.socketServer;
	self.socketController = options.socketController;
	self.cleanup = options.cleanup;
	self.authentication = options.authentication;
	self._channels = {};
	self._sockets = {};

	if(options.debug)
		self.debug = options.debug;
 
	// create the token route
	var requestToken = function(req, res){
		async.waterfall([
			function(callback){
				if(self.debug)
					console.log("Sockjs token request received ", req.query);
				if(typeof self.authentication === "function")
					self.authentication(req, callback); // use custom function with "req" as a parameter
				else if(typeof self.authentication === "string")
					callback(null, req.session[self.authentication]); // use custom session property	
				else
					callback(null, req.session.auth); // default
			}
		], function(error, auth){
			var type = utils.requestType(req);
			if(error){
				if(self.debug) console.log("Error issuing token", error);
				res[type](500, { error: error.message || error });
			}else if(!auth){
				if(self.debug) console.log("Rejected token request");
				res[type](400, { error: "Unauthorized" });
			}else{
				// issue a token
				var save = req.session || {};
				if(typeof auth === "object")
					save = auth;
				utils.issueToken(self.redisClient, save, function(error, token){
					if(self.debug) console.log("Attaching token to data: ", token, save);
					if(error)
						res[type](500, { error: error.message || error });
					else
						res[type](200, { token: token });
				});
			}
		});
	};

	if(options.customMiddleware){
		if(self.debug) console.log("Creating token route and attaching custom middleware");
		self.app.get(self.tokenRoute, options.customMiddleware, requestToken);
	}else{
		if(self.debug) console.log("Creating token route");
		self.app.get(self.tokenRoute, requestToken);
	}

	if(options.pubsubClient){
		if(self.debug) console.log("Setting up publish-subscribe functionality");
		self.pubsubClient = options.pubsubClient;
		self.pubsubClient.subscribe(ALL_CHANNEL);
		self.pubsubClient.on("message", function(channel, message){
			if(channel === ALL_CHANNEL){
				if(self.debug)
					console.log("Broadcasting message to all sockets on all channels", message);
				async.each(Object.keys(self._channels), function(_channel, callback){
					utils.writeSockets(self._channels[_channel], _channel, message);
					callback();
				});
			}else{
				if(self.debug)
					console.log("Pub-sub message received: ", channel, message);
				if(self._channels[channel])
					utils.writeSockets(self._channels[channel], channel, message);
			}
		});
	}

	if(self.cleanup)
		self.startCleanup(self.cleanup);

	self.socketServer.on("connection", function(socket){
		if(self.debug) console.log("Socket connection initiated");
		var sid = uuid.v4();
		socket.sid = sid;
		socket.created = new Date().getTime();
		self._sockets[sid] = socket;
		socket.on("close", function(){
			if(self.debug)
				console.log("Socket connection closed", sid);
			delete self._sockets[sid];
			if(self.pubsubClient && socket.channels){
				_.each(socket.channels, function(channel){
					delete self._channels[channel][socket.sid];
					if(Object.keys(self._channels[channel]).length === 0){
						self.pubsubClient.unsubscribe(channel);
						delete self._channels[channel];
					}
				});
			}
		});

		socket.on("data", function(message){
			try{
				message = JSON.parse(message);
			}catch(e){
				return socket.write(JSON.stringify({ error: "Invalid message" }));
			}

			if(self.debug)
				console.log("Socket message received", message);

			var sendMessage = function(error, resp){
				if(error)
					message.error = error.message || error;
				else
					message.resp = resp;
				if(self.debug)
					console.log("Writing message on socket", socket.sid, message);
				socket.write(JSON.stringify(message));
			};

			if(message.rpc === "auth" && message.token){
				if(self.debug)
					console.log("Socket auth request received", message.token);
				if(!message.token.match(/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}/i)){
					delete self._sockets[socket.id];
					return socket.end();
				}
				utils.verifyToken(self.redisClient, message.token, function(error, data){
					if(error || !data){
						if(self.debug)
							console.log("Error verifying token ", message.token, error);
						sendMessage(error.message || error || "Invalid token");
						delete self._sockets[socket.sid];
						socket.end();
					}else{
						if(self.debug)
							console.log("Successfully verified token ", message.token, data);
						socket.auth = true;
						sendMessage(null, "success");
						// only allow tokens to work once
						utils.revokeToken(self.redisClient, message.token, function(err){
							if(err)
								throw err;
						});
					}
				});
			}else if(!socket.auth){
				if(self.debug)
					console.log("Invalid socket message. Ending connection", sid, message);
				message.error = "Not authorized";
				socket.write(JSON.stringify(message));
				socket.end();
				delete self._sockets[socket.sid];
			}else{
				// check pub sub commands
				if(message.rpc && message.rpc === "_subscribe"){
					self.subscribe(socket, message.req.channel);
				}else if(message.rpc && message.rpc === "_publish"){
					self.publish(message.req.channel, message.req.data);
				}else if(message.rpc && message.rpc === "_unsubscribe"){
					self.unsubscribe(socket, message.req.channel);
				}else if(message.rpc && message.rpc === "_broadcast"){
					self.broadcast(message.req.data);
				}else if(message.rpc && self.socketController[message.rpc]){
					// proxy the socket controller
					self.socketController[message.rpc](message.req, sendMessage);
				}else{
					sendMessage("Invalid request");
				}
			}
		});
	});

};

TokenSocketServer.prototype.enableCleanup = function(interval){
	if(this.debug)
		console.log("Enabling cleanup process");
	this.cleanup = typeof interval === "number" ? interval : 5000;
	if(this.cleanupTimer)
		clearInterval(this.cleanupTimer);
	if(!(this.cleanupFn && typeof this.cleanupFn === "function")){
		this.cleanupFn = function(instance){
			if(instance.debug)
				console.log("Running cleanup process");
			var now = new Date().getTime();
			var diff = now - instance.cleanup;
			var deleted = [];
			// cleanup sockets
			async.each(instance.sockets() || [], function(socket, callback){
				if(!socket.auth && socket.created && socket.created < diff){
					if(instance.debug)
						console.log("Cleaning up socket", socket.sid);
					deleted.push(socket.sid);
					socket.end();
					delete instance._sockets[socket.sid];
				}
				callback();
			}, function(){
				// cleanup channels
				if(instance.pubsubClient){	
					async.each(Object.keys(instance._channels), function(channel, callback){
						async.each(deleted, function(sid, cb){
							delete instance._channels[channel][sid];
							if(Object.keys(instance._channels[channel]).length === 0)
								instance.pubsubClient.unsubscribe(channel);
							cb();
						}, callback);
					});
				}
			});
		};
	}
	this.cleanupTimer = setInterval(this.cleanupFn, this.cleanup, this);
};

TokenSocketServer.prototype.disableCleanup = function(){
	if(this.debug)
		console.log("Disabling cleanup");
	this.cleanup = null;
	if(this.cleanupTimer)
		clearInterval(this.cleanupTimer);
};

TokenSocketServer.prototype.subscribe = function(socket, channel){
	if(this.pubsubClient){
		if(this.debug)
			console.log("Subscribing socket ", socket.sid, channel);
		if(!this._channels[channel]){
			this.pubsubClient.subscribe(channel);
			this._channels[channel] = {};
		}
		this._channels[channel][socket.sid] = socket;
		if(!socket.channels)
			socket.channels = {};
		socket.channels[channel] = true;
		utils.sync(socket, "subscribe", { channel: channel });
	}
};

TokenSocketServer.prototype.unsubscribe = function(socket, channel){
	if(this.pubsubClient){
		if(this.debug)
			console.log("Unsubscribing socket ", socket.sid, channel);
		delete socket.channels[channel];
		delete this._channels[channel][socket.sid];
		if(Object.keys(this._channels[channel]).length === 0){
			this.pubsubClient.unsubscribe(channel);
			delete this._channels[channel];
		}
		utils.sync(socket, "unsubscribe", { channel: channel });
	}
};

TokenSocketServer.prototype.sockets = function(){
	var self = this;
	return _.map(Object.keys(self._sockets), function(sid){
		return self._sockets[sid];
	});
};

TokenSocketServer.prototype.channels = function(){
	return Object.keys(this._channels);
};

// publish a message on a channel
TokenSocketServer.prototype.publish = function(channel, data){
	if(this.pubsubClient){
		if(this.debug)
			console.log("Publishing message", channel, data);
		if(typeof data === "object")
			data = JSON.stringify(data);
		this.redisClient.publish(channel, data);
	}
};

// publish a message on all channels
TokenSocketServer.prototype.broadcast = function(data){
	if(this.pubsubClient){
		var self = this;
		if(self.debug)
			console.log("Broadcasting message", data);
		if(typeof data === "object")
			data = JSON.stringify(data);
		self.redisClient.publish(ALL_CHANNEL, data);
	}
};

// remove all sockets and channels
TokenSocketServer.prototype.shutdown = function(){
	if(this.debug)
		console.log("Shutting down server...");
	var self = this;
	self.app.routes.get = _.filter(self.app.routes.get, function(route){
		return route.path !== self.tokenRoute;
	});
	if(self.debug)
		console.log("Removed token route");
	_.each(self._sockets, function(socket, sid){
		socket.end();
	});
	if(self.debug)
		console.log("Closed all sockets");
	self._sockets = {};
	if(self.pubsubClient){
		_.each(self._channels, function(sockets, channel){
			delete self._channels[channel];
			self.pubsubClient.unsubscribe(channel);
		});
		if(self.debug)
			console.log("Unsubscribed from all channels");
	}
};

module.exports = TokenSocketServer;

