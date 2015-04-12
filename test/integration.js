var sinon = require("sinon");

global.defer = function(callback){
  setTimeout(callback, 15);
};

module.exports = function(TokenSocketServer){

  var express = require("express"),
      sockjs = require("sockjs"),
      redis = require("redis"),
      RestJS = require("restjs"),
      MockSocket = require("./mocks/socket"),
      MockSocketServer = require("./mocks/socketServer"),
      http = require("http");

  if(typeof RestJS === "object" && RestJS.Rest)
    RestJS = RestJS.Rest;

  var httpClient = new RestJS({ protocol: "http" });

  var redisHost = process.env.REDIS_HOST || "127.0.0.1",
      redisPort = process.env.REDIS_PORT || 6379;

  var redisClient = redis.createClient(redisPort, redisHost),
      pubsubClient = redis.createClient(redisPort, redisHost);

  var app = express(),
      socketServer = new MockSocketServer();

  var server = http.createServer(app),
      port = process.env.PORT || 6072;

  socketServer.installHandlers(server, {
    prefix: "/sockets",
    sockjs_url: "//cdn.sockjs.org/sockjs-0.3.min.js"
  });

  var tokenServer = new TokenSocketServer(app, redisClient, socketServer, {
    pubsubClient: pubsubClient,
    socketController: {
      echo: sinon.spy(function(auth, data, callback){
        callback(null, data);
      }),
      nested: {
        echo: sinon.spy(function(auth, data, callback){
          callback(null, data);
        })
      }
    },
    customMiddleware: function(req, res, next){
      if(req.param("middleware")){
        res.json({ middleware: 1 });
      }else{
        req.session = req.session || {};
        req.session.foo = "bar";
        next();
      }
    },  
    authentication: function(req, callback){
      callback(null, req.param("allow"));
    },
    routes: {
      ping: function(req, res){
        res.json(req.body);
      },
      nested: {
        ping: function(req, res){
          res.json(req.body);
        }
      }
    },
    filter: sinon.spy(function(socket, channel, message){
      if(channel === "baz")
        message.foo = "bar";
      else if(channel === "bad")
        message = null;
      return message;
    }),
    ping: true
  });

  describe("Integration tests", function(){

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

    require("./integration/authentication")(tokenServer, httpClient, MockSocket, options);
    require("./integration/rpc")(tokenServer, httpClient, MockSocket, options);
    require("./integration/pubsub")(tokenServer, httpClient, MockSocket, options);

  });

};