
var _ = require("lodash"),
	sinon = require("sinon"),
	async = require("async"),
	EventEmitter = require("events").EventEmitter;

module.exports = function(tokenServer, httpClient, TokenSocket, options){

	describe("Publish subscribe tests", function(){

		var socket, token,
			channel = "foo",
			message = { foo: "bar" };

		var fnArgMap = {
			broadcast: {
				rpc: "_broadcast",
				req: { data: message }
			},
			publish: {
				rpc: "_publish",
				req: { 
					channel: channel, 
					data: message 
				}
			},
			unsubscribe: {
				rpc: "_unsubscribe",
				req: { channel: channel }
			},
			subscribe: {
				rpc: "_subscribe",
				req: { channel: channel }
			}
		};

		_.each(fnArgMap, function(data, fnKey){
			tokenServer[fnKey] = sinon.spy(tokenServer[fnKey]);
		});

		beforeEach(function(done){
			_.each(fnArgMap, function(data, fnKey){
				tokenServer[fnKey].reset();
			});

			socket = new TokenSocket();
			var opts = _.extend({}, options);
			opts.method = "GET";
			opts.path = tokenServer.tokenRoute + "?allow=1";
			httpClient.request(opts, null, function(error, resp){
				token = JSON.parse(resp.body).token;
				socket = new TokenSocket();
				tokenServer.socketServer._connection(socket);
				socket._rpc("auth", { token: token });

				// wait for redis to respond... I should probably mock that...
				defer(function(){
					socket._frames.shift();
					done();
				});
			});
		});

		afterEach(function(){
			socket._emit("close");
		});

		it("Should allow sockets to subscribe to channels", function(done){
			assert.lengthOf(Object.keys(tokenServer._channels), 0, "No sockets listening to any channels");
			assert.lengthOf(Object.keys(socket.channels), 0, "Socket not listening to test channel");
			assert.lengthOf(socket._frames, 0, "Socket does not have any outgoing frames");

			var frame = {
				rpc: "_subscribe",
				req: { channel: channel }
			};

			socket._emit("data", JSON.stringify(frame));

			defer(function(){

				assert.lengthOf(Object.keys(tokenServer._channels[channel]), 1, "One socket listening to test channel");
				assert.ok(tokenServer._channels[channel][socket.sid], "Server stores socket ID in channel map");
				assert.lengthOf(Object.keys(socket.channels), 1, "Socket is listening to test channel");
				assert.ok(socket.channels[channel], "Socket channel map has correct channel name");

				assert.lengthOf(socket._frames, 1, "Socket has one outgoing frame");
				var responseFrame = socket._frames.shift();
				assert.ok(responseFrame, "Response frame is ok");
				responseFrame = JSON.parse(responseFrame);

				assert.isTrue(responseFrame.internal, "Response frame has internal flag");
				assert.equal(responseFrame.command, "subscribe", "Response frame has correct command");
				assert.deepEqual(responseFrame.data, { channel: channel }, "Response frame has correct data");

				done();
			});
		});

		it("Should allow sockets to publish data on channels", function(done){
			tokenServer.publish = sinon.spy(tokenServer.publish);

			assert.lengthOf(Object.keys(tokenServer._channels), 0, "No sockets listening to any channels");
			assert.lengthOf(Object.keys(socket.channels), 0, "Socket not listening to test channel");
			assert.lengthOf(socket._frames, 0, "Socket does not have any outgoing frames");

			var frame = {
				rpc: "_publish",
				req: { 
					channel: channel,
					data: message
				}
			};

			assert.isFalse(tokenServer.publish.called, "Publish was not called yet");
			socket._emit("data", JSON.stringify(frame));

			defer(function(){
				assert.isTrue(tokenServer.publish.calledOnce, "Publish was called once");
				assert.isTrue(tokenServer.publish.calledWith(channel, message));
				assert.lengthOf(socket._frames, 0, "Socket has zero outgoing frames");
				tokenServer.publish.reset();
				done();
			});
		});

		it("Should allow sockets to unsubscribe from channels", function(done){
			assert.lengthOf(Object.keys(tokenServer._channels), 0, "No sockets listening to any channels");
			assert.lengthOf(Object.keys(socket.channels), 0, "Socket not listening to test channel");
			assert.lengthOf(socket._frames, 0, "Socket does not have any outgoing frames");

			var testSubscribe = function(callback){
				var subFrame = {
					rpc: "_subscribe",
					req: { channel: channel }
				};

				socket._emit("data", JSON.stringify(subFrame));
				defer(function(){
					assert.lengthOf(Object.keys(tokenServer._channels[channel]), 1, "One socket listening to test channel");
					assert.ok(tokenServer._channels[channel][socket.sid], "Server stores socket ID in channel map");
					assert.lengthOf(Object.keys(socket.channels), 1, "Socket is listening to test channel");
					assert.ok(socket.channels[channel], "Socket channel map has correct channel name");
					socket._frames.shift();
					callback();
				});
			};

			var testUnsubscribe = function(callback){
				tokenServer.unsubscribe = sinon.spy(tokenServer.unsubscribe);

				var unsubFrame = {
					rpc: "_unsubscribe",
					req: { channel: channel }
				};

				socket._emit("data", JSON.stringify(unsubFrame));

				defer(function(){
					assert.isTrue(tokenServer.unsubscribe.calledOnce, "Unsubscribe was called once");
					assert.isTrue(tokenServer.unsubscribe.calledWith(socket, channel), "Unsubscribe called with right args");
					assert.notOk(tokenServer._channels[channel], "Server channel has been cleaned up");
					assert.notOk(socket.channels[channel], "Socket channel has been cleaned up");
					assert.lengthOf(socket._frames, 1, "Socket has one frame");
					var responseFrame = socket._frames.shift();
					assert.ok(responseFrame, "Response frame is ok");
					responseFrame = JSON.parse(responseFrame);
					assert.isTrue(responseFrame.internal, "Response frame has internal flag");
					assert.equal(responseFrame.command, "unsubscribe", "Response frame has correct command");
					assert.deepEqual(responseFrame.data, unsubFrame.req, "Response frame has correct data");
					tokenServer.unsubscribe.reset();
					callback();
				});
			};

			async.series([
				testSubscribe,
				testUnsubscribe
			], done);
		});

		it("Should send messages to sockets subscribed to channels on which data is published", function(done){
			assert.lengthOf(Object.keys(tokenServer._channels), 0, "No sockets listening to any channels");
			assert.lengthOf(Object.keys(socket.channels), 0, "Socket not listening to test channel");
			assert.lengthOf(socket._frames, 0, "Socket does not have any outgoing frames");

			var testSubscribe = function(callback){
				var subFrame = {
					rpc: "_subscribe",
					req: { channel: channel }
				};

				socket._emit("data", JSON.stringify(subFrame));
				defer(function(){
					socket._frames.shift();
					callback();
				});
			};

			var testPublish = function(callback){
				var publishFrame = {
					rpc: "_publish",
					req: {
						channel: channel,
						data: message
					}
				};

				socket._emit("data", JSON.stringify(publishFrame));
				assert.lengthOf(socket._frames, 0, "Socket has no outstanding frames");
				defer(callback);
			};

			var testMessageHandler = function(callback){
				assert.lengthOf(socket._frames, 1, "Socket has one outgoing frame");
				var responseFrame = socket._frames.shift();
				assert.ok(responseFrame, "Response frame is ok");
				responseFrame = JSON.parse(responseFrame);

				assert.equal(responseFrame.channel, channel, "Response frame has correct channel");
				assert.deepEqual(responseFrame.message, message, "Response frame has correct message");
				callback();
			};

			async.series([
				testSubscribe,
				testPublish,
				testMessageHandler
			], done);
		});

		it("Should prevent sockets from seeing messages on channels on which they're not listening", function(done){
			assert.lengthOf(Object.keys(tokenServer._channels), 0, "No sockets listening to any channels");
			assert.lengthOf(Object.keys(socket.channels), 0, "Socket not listening to test channel");
			assert.lengthOf(socket._frames, 0, "Socket does not have any outgoing frames");

			var testSubscribe = function(callback){
				var subFrame = {
					rpc: "_subscribe",
					req: { channel: channel }
				};

				socket._emit("data", JSON.stringify(subFrame));
				defer(function(){
					socket._frames.shift();
					callback();
				});
			};

			var testPublish = function(callback){
				var publishFrame = {
					rpc: "_publish",
					req: {
						channel: channel + "blah",
						data: message
					}
				};

				socket._emit("data", JSON.stringify(publishFrame));
				assert.lengthOf(socket._frames, 0, "Socket has no outstanding frames");
				defer(callback);
			};

			var testMessageHandler = function(callback){
				assert.lengthOf(socket._frames, 0, "Socket has zero outgoing frames");
				callback();
			};

			async.series([
				testSubscribe,
				testPublish,
				testMessageHandler
			], done);
		});

		// subscribes to two channels and verfies that the message arrived on both
		it("Should allow sockets to broadcast messages on all channels", function(done){
			assert.lengthOf(Object.keys(tokenServer._channels), 0, "No sockets listening to any channels");
			assert.lengthOf(Object.keys(socket.channels), 0, "Socket not listening to test channel");
			assert.lengthOf(socket._frames, 0, "Socket does not have any outgoing frames");

			var testSubscribe = function(callback){
				async.timesSeries(2, function(idx, cb){
					var subFrame = {
						rpc: "_subscribe",
						req: { channel: channel + idx }
					};

					socket._emit("data", JSON.stringify(subFrame));
					defer(function(){
						socket._frames.shift();
						cb();
					});
				}, callback);
			};

			var testBroadcast = function(callback){
				var broadcastFrame = {
					rpc: "_broadcast",
					req: { data: message }
				};

				socket._emit("data", JSON.stringify(broadcastFrame));
				assert.lengthOf(socket._frames, 0, "Socket has no outstanding frames");
				defer(callback);
			};

			var testMessageHandler = function(callback){
				assert.lengthOf(socket._frames, 2, "Socket has two outgoing frames");
				var firstFrame = JSON.parse(socket._frames.shift());
				var secondFrame = JSON.parse(socket._frames.shift());
				assert.ok(firstFrame.channel, "First frame has channel");
				assert.deepEqual(firstFrame.message, message, "First frame has correct channel");
				assert.ok(secondFrame.channel, "Second frame has channel");
				assert.deepEqual(secondFrame.message, message, "Second frame has correct message");
				assert.notEqual(firstFrame.channel, secondFrame.channel, "Channels are different");
				var channels = tokenServer.channels();
				assert.include(channels, firstFrame.channel, "First frame's channel exists");
				assert.include(channels, secondFrame.channel, "Second frame's channel exists");
				callback();
			};

			async.series([
				testSubscribe,
				testBroadcast,
				testMessageHandler
			], done);
		});

		it("Should allow sockets to make pubsub actions if all listeners allow it", function(done){
			var sayYesOne = sinon.spy(function(_socket, data, callback){
				assert.equal(socket.sid, _socket.sid, "Sockets match");
				callback(null, true);
			});

			var sayYesTwo = sinon.spy(function(_socket, data, callback){
				assert.equal(socket.sid, _socket.sid, "Sockets match");
				callback(null, true);
			});

			async.eachSeries(Object.keys(fnArgMap), function(fnKey, cb){
				assert.equal(EventEmitter.listenerCount(tokenServer._emitter, fnKey), 0, "Server's event emitter has no listeners bound to this event");
				assert.lengthOf(socket._frames, 0, "Socket has no outgoing frames");
				tokenServer.on(fnKey, sayYesOne);
				tokenServer.on(fnKey, sayYesTwo);

				var data = fnArgMap[fnKey];
				socket._emit("data", JSON.stringify(data));

				defer(function(){
					socket._frames.shift();
					assert.isTrue(sayYesOne.calledOnce, "First listener was called");
					assert.isTrue(sayYesTwo.calledOnce, "Second listener was called");
					assert.isTrue(tokenServer[fnKey].calledOnce, "Token server function was called");
					tokenServer.removeAllListeners(fnKey);
					sayYesOne.reset();
					sayYesTwo.reset();
					tokenServer[fnKey].reset();
					cb();
				});
			}, done);
		});

		it("Should prevent sockets from taking any pubsub action if a listener returns an error or false", function(done){
			var sayYes = sinon.spy(function(_socket, data, callback){
				assert.equal(socket.sid, _socket.sid, "Sockets match");
				callback(null, true);
			});

			var sayNo = sinon.spy(function(_socket, data, callback){
				assert.equal(socket.sid, _socket.sid, "Sockets match");
				callback(null, false);
			});

			async.eachSeries(Object.keys(fnArgMap), function(fnKey, cb){
				assert.equal(EventEmitter.listenerCount(tokenServer._emitter, fnKey), 0, "Server's event emitter has no listeners bound to this event");
				assert.lengthOf(socket._frames, 0, "Socket has no outgoing frames");
				tokenServer.on(fnKey, sayYes);
				tokenServer.on(fnKey, sayNo);

				var data = fnArgMap[fnKey];
				socket._emit("data", JSON.stringify(data));

				defer(function(){
					assert.lengthOf(socket._frames, 1, "Socket has one frame");
					var errorFrame = socket._frames.shift();
					assert.ok(errorFrame, "Error frame is ok");
					errorFrame = JSON.parse(errorFrame);
					assert.equal(errorFrame.error, "Forbidden", "Error frame has correct message");
					assert.isTrue(sayYes.called, "First listener was called");
					assert.isTrue(sayNo.called, "Second listener was called");
					assert.isFalse(tokenServer[fnKey].called, "Token server function was not called");
					tokenServer.removeAllListeners(fnKey);
					sayYes.reset();
					sayNo.reset();
					tokenServer[fnKey].reset();
					cb();
				});
			}, done);
		});

		it("Should allow users to filter outgoing data on the pubsub network", function(done){
			var testChannel = "baz",
				testMessage = { a: "b" };

			assert.lengthOf(socket._frames, 0, "Socket has no outgoing frames");
			tokenServer.subscribe(socket, testChannel);
			defer(function(){
				assert.lengthOf(socket._frames, 1, "Socket has one frame");
				var frame = socket._frames.shift();
				assert.ok(frame, "Frame is ok");
				frame = JSON.parse(frame);
				assert.ok(frame.internal, "First frame is internal subscribe frame");

				tokenServer.publish(testChannel, testMessage);

				defer(function(){
					assert.lengthOf(socket._frames, 1, "Socket has one frame");
					frame = socket._frames.shift();
					assert.ok(frame, "Frame is ok");
					frame = JSON.parse(frame);
					assert.equal(frame.message.foo, "bar", "Filter fn changed outgoing data");
					assert.isTrue(tokenServer._filter.called, "Filter was called");
					done();
				});
			});
		});

		it("Should not send messages to clients if the filter function returns a falsy value", function(done){
			var testChannel = "bad",
				testMessage = { a: "b" };

			assert.lengthOf(socket._frames, 0, "Socket has no outgoing frames");
			tokenServer.subscribe(socket, testChannel);
			defer(function(){
				assert.lengthOf(socket._frames, 1, "Socket has one frame");
				var frame = socket._frames.shift();
				assert.ok(frame, "Frame is ok");
				frame = JSON.parse(frame);
				assert.ok(frame.internal, "First frame is internal subscribe frame");

				tokenServer.publish(testChannel, testMessage);

				defer(function(){
					assert.lengthOf(socket._frames, 0, "Socket has no frames");
					assert.isTrue(tokenServer._filter.called, "Filter was called");
					done();
				});
			});
		});

	});

};