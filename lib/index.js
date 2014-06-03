/**
 * Class File: index
 * Created by Adrian on 02-Jun-14.
 */
require('./core/utils.js');

var COMPONENTS = {
	proxy: require('./proxy/index.js'),
	node: require('./node.js')
};
module.exports = COMPONENTS;