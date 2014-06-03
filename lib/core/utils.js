/**
 * Class File: logger
 * Created by Adrian on 02-Jun-14.
 */
log4js = require('log4js');

log4js.configure({
	appenders: [{
		type: 'console',
		category: 'console'
	}]
});

global.log = log4js.getLogger('console');

var utils = {};

/*
* Generates a unique ID of the given length.
* */
utils.uniqueId = function UniqueId() {
	var _p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890",
		r = "",
		strLen = _p.length,
		length = typeof len == "number" ? len : 16;
	if(length <=0) length = 16;
	for(var i=0; i< length; i++) {
		r += _p.charAt(Math.floor(Math.random() * strLen));
	}
	return r;
};

module.exports = utils;