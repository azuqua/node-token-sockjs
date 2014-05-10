
var async = require("async"),
	_ = require("underscore"),
	uuid = require("node-uuid"),
	sockjsClient = require("sockjs-client-ws");

// TODO make a node-token-sockjs-client module, not just a lazy port of the browser version

var Monitor = function(socket, messageCallback){
	this.socket = socket;
	this.inTransit = {};
	this.messageCallback = messageCallback || function(){};
};

Monitor.prototype.sendMessage = function(data, callback){
	if(typeof data === "string")
		data = JSON.parse(data);
	var _uuid = uuid.v4();
	data.uuid = _uuid;
	if(!this.inTransit[data.rpc])
		this.inTransit[data.rpc] = {};
	this.inTransit[data.rpc][_uuid] = callback;
	this.socket.send(JSON.stringify(data));
};

Monitor.prototype.handleResponse = function(data){
	var fn = null;
	if(data.rpc && data.uuid)
		fn = this.inTransit[data.rpc][data.uuid];
	if(fn){
		if(data.error)
			fn(data.error);
		else
			fn(null, data.resp);
		delete this.inTransit[data.rpc][data.uuid];
	}else if(this.messageCallback){
		this.messageCallback(data.channel, data.message);
	}
};

var handleInternal = function(instance, command, data){
	switch(command){
		case "subscribe":
			instance._channels[data.channel] = true;
		break;
		case "unsubscribe":
			delete instance._channels[data.channel];
		break;
	};
};

var MockClient = function(host, token, prefix){
	var self = this;
	self.token = token;
	self._channels = {};
	self.socket = sockjsClient.create(host + prefix);
	self.socket.on("connection", function(){
		self.monitor.sendMessage({
			rpc: "auth",
			token: self.token
		}, function(error, resp){
			if(error)
				self.ready(error);
			else
				self.ready(null, true)
		});
	});
	self.monitor = new Monitor(self.socket);
	self.socket.on("data", function(msg){
		msg = JSON.parse(msg);
		if(msg.internal)
			handleInternal(self, msg.command, msg.data);
		else
			self.monitor.handleResponse(msg);
	});
};

MockClient.prototype.ready = function(callback){
	this.ready = callback;
};

MockClient.prototype.rpc = function(rpc, data, callback){
	this.monitor.sendMessage({
		rpc: rpc,
		req: data
	}, callback);
};

MockClient.prototype.subscribe = function(channel){
	this._channels[channel] = true;
	this.monitor.sendMessage({
		rpc: "_subscribe",
		req: { channel: channel }
	});
};

MockClient.prototype.unsubscribe = function(channel){
	delete this._channels[channel];
	this.monitor.sendMessage({
		rpc: "_unsubscribe",
		req: { channel: channel }
	});
};

MockClient.prototype.publish = function(channel, data){
	this.monitor.sendMessage({
		rpc: "_publish",
		req: { 
			channel: channel,
			data: data
		}
	});
};

MockClient.prototype.broadcast = function(data){
	this.monitor.sendMessage({
		rpc: "_broadcast",
		req: { data: data }
	});
};

MockClient.prototype.onmessage = function(callback){
	this.monitor.messageCallback = callback;
};

MockClient.prototype.channels = function(){
	return Object.keys(this._channels);
};

MockClient.prototype.end = function(callback){
	this.socket.close();
	this.socket.onclose = callback;
};

module.exports = MockClient;
