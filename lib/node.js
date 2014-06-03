/*
* The node component acts as a single HTTP server instance. It also registers itself in the cluster
* and tells the balancer to route traffic to it.
* */
var BlastConfig = require('./core/configuration.js'),
	util = require('util'),
	request = require('request'),
	EventEmitter = require('events').EventEmitter;

var DEFAULTS = {
	proxy: {
		hostname: 'localhost',			/* The REGISTRATION hostname of the proxy server. */
		port: 18755,					/* The REGISTRATION port of the proxy server. The nodes use this to register in the cluster */
		key: null						/* The REGISTRATION authentication key. If set to null on the proxy, it will not have authentication */
	},
	node: {
		hostname: 'localhost',		/* The hostname of the HTTP server to proxy users to */
		port: 4001,					/* This is the port of the HTTP server to proxy users to */
		connections: 1000			/* The maximum amount of connections per minute to be routed to this node. */
	}
};

var node = function BlastNode() {
	this.id = null;		/* this is the node's id, given by the proxy server. */
	this.config = new BlastConfig(DEFAULTS);
	this.__timeout = {
		ping: null	/* This is where we keep the ping timeout */
	};
	this.__timer = {
		ping: null	/* The number of seconds the proxy tells us to ping it. */
	};
	EventEmitter.call(this);
};
util.inherits(node, EventEmitter);

/*
 * Configures the node with a given configuration for a given environment. If no environment is given, 'development' will be used.
 * Arguments:
 * 	_env - string, the environment we want to use
 * 	_data - object, the configuration data we want to use for the given environment
 * */
node.prototype.configure = function Configure(_env, _data) {
	var env = (typeof _env == 'string' ? _env : 'development'),
		data = (typeof _data == 'object' && _data != null ? _data : (typeof _env == 'object' && _env != null ? _env : {}));
	this.config.setData(env, data);
	return this;
};

/*
* The function will register the node in the cluster. It will send all the necessary information of a given node to the proxy
* so that it can start redirecting traffic to it.
* Arguments:
* 		callback - the callback that will be called when the node will be registered.
* */
node.prototype.register = function Register(_callback) {
	var self = this,
		callback = (typeof _callback == 'function' ? _callback : function(){}),
		_config = this.config.get(),
		_data = {
			form: {
				hostname: _config.node.hostname,
				port: _config.node.port
			}
		};
	if(_config.proxy.key != null) _data.form['key'] = _config.proxy.key;
	if(_config.node.connections) _data.form['connections'] = _config.node.connections;
	request.post(self.getProxyUrl('register'), _data, function(err, res, body) {
		if(err) {
			return callback(err);
		}
		var data;
		try {
			data = JSON.parse(body);
		} catch(e) {
			return callback(e);
		}
		self.__timer.ping = parseInt(data.ping);
		self.id = data.id;
		/* We now start the ping process. */
		self.startPing();
	});
	return this;
};

/* Returns the request URL of the proxy. */
node.prototype.getProxyUrl = function GetProxyUrl(path) {
	var _config = this.config.get();
	var s = 'http://' + _config.proxy.hostname + ':' + _config.proxy.port + '/' + path;
	if(_config.proxy.key != null) {
		s += '?key=' + _config.proxy.key;
	}
	return s;
};

/*
* Starts the ping process, maintaining the node in the cluster.
* */
node.prototype.startPing = function StartPing() {
	var self = this,
		_config = this.config.get(),
		_data = {
			form: {
				id: self.id
			}
		};
	if(_config.proxy.key != null) _data.form['key'] = _config.proxy.key;
	if(this.__timeout.ping != null) clearTimeout(this.__timeout.ping);
	this.__timeout.ping = setTimeout(function() {
		request.post(self.getProxyUrl('ping'), _data, function(err, res, body) {
			if(err) {
				err.name = 'PING_ERROR';
				self.register();
				self.emit('error', err);
				return;
			}
			try {
				var data = JSON.parse(body);
			} catch(e) {
				e.name = 'PING_ERROR';
				self.emit('error', e);
				return;
			}
			if(data.type == 'error') {
				/* If by any chance the proxy restarted, we need to re-register */
				if(data.code == 1) {
					return self.register();
				}
				var e = new Error('PING_ERROR');
				e.details = data;
				self.emit('error', e);
				return;
			}
			self.startPing();
		});
	}, this.__timer.ping);
};

module.exports = node;