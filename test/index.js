
var chai = global.chai = require("chai"),
	TokenSocketServer = require("../index");

global.assert = chai.assert;

describe("Unit Tests", function(){
	require("./unit.js")(TokenSocketServer);
});

describe("Integration Tests", function(){
  require("./integration.js")(TokenSocketServer);
});