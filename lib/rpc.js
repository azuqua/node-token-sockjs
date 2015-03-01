
var async       = require("async"),
    _           = require("lodash"),
    utils       = require("./utils"),
    ALL_CHANNEL = "__all__",
    SYNC_CHANNEL = "___sync___";

module.exports = function(socket, message, callback){
  if(!message.rpc)
    return callback("Invalid request");

  var self = this;
  switch(message.rpc){
  case "_subscribe":
    utils.checkListeners(self._emitter, "subscribe", socket, message, function(error, allowed){
      if(error || !allowed)
        callback(error || "Forbidden");
      else
        self.subscribe(socket, message.req.channel);
    });
    break;
  case "_unsubscribe": 
    utils.checkListeners(self._emitter, "unsubscribe", socket, message, function(error, allowed){
      if(error || !allowed)
         callback(error || "Forbidden");
      else
        self.unsubscribe(socket, message.req.channel);
    });
    break;
  case "_publish":
    utils.checkListeners(self._emitter, "publish", socket, message, function(error, allowed){
      if(error || !allowed || message.req.channel === ALL_CHANNEL || message.req.channel === SYNC_CHANNEL)
        callback(error || "Forbidden");
      else
        self.publish(message.req.channel, message.req.data);
    });
    break;
  case "_broadcast":
    utils.checkListeners(self._emitter, "broadcast", socket, message, function(error, allowed){
      if(error || !allowed)
        callback(error || "Forbidden");
      else
        self.broadcast(message.req.data);
    });
    break;
  case "_rpc":
    if(message.fid && self._inTransit[message.fid]){
      var fn = self._inTransit[message.fid];
      if(typeof fn === "function")
        fn(message.resp.error, message.resp.data);
      delete self._inTransit[message.fid];  
    }
    break;
  default:
    // proxy the socket controller
    var action = utils.checkController(self.socketController, self._routes, message.rpc);
    if(action && typeof action === "function")
      action(socket.auth, message.req, callback, socket);
    else
      callback("Function not found");
    break;
  }

};