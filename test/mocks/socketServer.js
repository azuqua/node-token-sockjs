

var sinon = require("sinon"),
	_ = require("lodash"),
	EventEmitter = require("events").EventEmitter;

var MockSocketServer = function(){
	this._sockets = [];
	this._options = {};
	this._emitter = new EventEmitter();
};

MockSocketServer.prototype.installHandlers = function(options){
	this._options = options;
};

MockSocketServer.prototype.on = function(event, callback){
	this._emitter.addListener(event, callback);
};

MockSocketServer.prototype._emit = function(){
	this._emitter.emit.apply(this._emitter, Array.prototype.slice.call(arguments));
};

MockSocketServer.prototype._connection = function(socket){
	this._emit("connection", socket);
};

module.exports = MockSocketServer;