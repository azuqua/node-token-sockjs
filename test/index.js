
var chai = global.chai = require("chai"),
	TokenSocketServer = require("../index");

global.assert = chai.assert;

require("./unit.js")(TokenSocketServer);
require("./integration.js")(TokenSocketServer);