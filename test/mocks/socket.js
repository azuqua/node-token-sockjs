
var sinon = require("sinon"),
	EventEmitter = require("events").EventEmitter,
	_ = require("lodash");

var MockSocket = function(){
	this._frames = []; 
	this._closed = false;
	this._emitter = new EventEmitter();
};

MockSocket.prototype.on = sinon.spy(function(event, callback){
	this._emitter.addListener(event, callback);
});

MockSocket.prototype._emit = function(){
	this._emitter.emit.apply(this._emitter, Array.prototype.slice.call(arguments));
};

MockSocket.prototype._rpc = function(name, data){
	this._emit("data", JSON.stringify(_.extend(data || {}, { rpc: name })));
};

MockSocket.prototype.write = sinon.spy(function(data){
	this._frames.push(typeof data === "object" ? JSON.stringify(data) : data);
});

MockSocket.prototype.end = sinon.spy(function(){
	this._closed = true;
});

module.exports = MockSocket;