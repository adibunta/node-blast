var utils = require('./../core/utils.js'),
	EventEmitter = require('events').EventEmitter,
	util = require('util'),
	crypto = require('crypto');

/*
* The node will emit the following events:
* 	ping - when it receives a ping
* 	timeout - when the node times out and it is placed in offline mode
* 	expire	- when the node exceeds a given amount of time marked as offline.
* */

/*
* This is a node's representation. It holds up the information of a node inside the proxy.
* */
var node = function ProxyNode(_config) {
	this.config = {
		hostname: _config.hostname,
		port: parseInt(_config.port),
		max_connections: (typeof _config.connections == 'string' ? parseInt(_config.connections) : null)
	};
	this.id = crypto.createHash('md5').update(this.getConnectionString()).digest('hex');
	this.redirects = 0;	/* The total amount of redirects since the last reset. Resets are usually once a minute. */
	this.fails = 0;		/* The total number of failed pings */
	this.online = false;
	this.destroyed = false;
	this.__interval = {
		timeout: null,	/* The request timeout check */
		fail: null	/* The fail counter */
	};
	EventEmitter.call(this);
	this.setMaxListeners(100);
};
util.inherits(node, EventEmitter);

/*
* Checks if this node can accept any redirect
* Returns false if:
* 	- it is offline
* 	- max connections per minute achieved
* */
node.prototype.canRedirect = function CanRedirect() {
	if(this.online == false) return false;
	if(this.config.max_connections != null && this.config.max_connections <= this.redirects) return false;
	return true;
};


/*
* Returns the connection string of t he current node.
* */
node.prototype.getConnectionString = function GetConnectionString() {
	var s = "http://" + this.config.hostname.toLowerCase();
	s += ':' + this.config.port;
	return s;
};

/*
* Enables the node supervisor, which resets node redirect counts as well as ping timeouts.
* */
node.prototype.supervise = function StartSupervision(clusterConfig) {
	var self = this;
	if(this.__interval.timeout != null) clearTimeout(this.__interval.timeout);
	if(this.__interval.fail != null) clearInterval(this.__interval.fail);
	this.config.timers = {
		timeout: clusterConfig.timeout
	};
	setTimeout(function() {
		self.__interval.fail = setInterval(function() {
			if(self.online == false) self.fails++;
			if(self.fails >= clusterConfig.fails) {
				self.emit('expire');
			}
		}, (clusterConfig.timeout * 1000));
	}, (clusterConfig.timeout * 1000)/2);
	this.onPing(true);
};

/*
* Starts the ping timer.
* */
node.prototype.onPing = function PingTimer(firstTime) {
	this.online = true;
	this.fails = 0;
	clearTimeout(this.__interval.timeout);
	if(typeof firstTime != 'boolean') this.emit('ping');
	var self = this;
	this.__interval.timeout = setTimeout(function() {
		self.online = false;
		self.emit('timeout');
	}, this.config.timers.timeout * 1000);
};


/*
* Stops the node supervisor
* */
node.prototype.destroy = function Destroy() {
	clearTimeout(this.__interval.timeout);
	clearInterval(this.__interval.fail);
	this.destroyed = true;
	return this;
};

module.exports = node;