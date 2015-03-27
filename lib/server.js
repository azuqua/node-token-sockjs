
var _            = require("lodash"),
    EventEmitter = require("events").EventEmitter,
    utils        = require("./utils"),
    setup        = require("./setup"),
    rpc          = require("./rpc"),
    external     = require("./external");

var TokenSocketServer = function(app, client, server, options){
  if(!app || !client || !server)
    throw new Error("Node Token Sockjs: Error creating server. Express server, Sockjs server, and Redis client required.");

  var defaults = {
    prefix: "/sockets",
    tokenRoute: "/socket/token",
    socketController: {},
    log: console.log,
    authentication: "auth",
    pubsubClient: null,
    debug: false,
    routes: {}
  };

  var self = this;

  _.each(defaults, function(val, key){
    self[key] = options && typeof options === "object" ? options[key] || defaults[key] : defaults[key];
  });

  _.extend(self, {
    app: app,
    redisClient: client,
    socketServer: server,
    _debug: utils.debug.bind(self),
    _rpc: rpc.bind(self),
    _channels: {},
    _sockets: {},
    _inTransit: {},
    _emitter: new EventEmitter(),
    _filter: options.filter || null
  });

  setup.call(self, options);
};

_.extend(TokenSocketServer.prototype, external);

module.exports = TokenSocketServer;
