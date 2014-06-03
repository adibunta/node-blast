/*
* A Configuration class contains various configuration objects for different components.
* */

var config = function BlastConfiguration(_default) {
	this.__default = {};	// This represents the default configuration that a component will use.
	this.__data = {};		// This represents the given configuration to use by a component.
	this.__env = null;		// This is the current and active environment.
	if(typeof _default == 'object' && _default != null) {
		this.__default = _default;
	}
};

/*
* Sets the configuration data received to the given environment.
* */
config.prototype.setData = function SetData(env, _data) {
	this.__data[env] = extend(this.__default, _data);
	this.__env = env;
};

/*
* Returns the active configuration data.
* */
config.prototype.get = function GetData() {
	if(this.__env == null) return this.__default;
	if(typeof this.__data[this.__env] == 'undefined') return this.__default;
	return this.__data[this.__env];
};

function extend(dest, from) {
	var props = Object.getOwnPropertyNames(from), destination;
	props.forEach(function (name) {
		if (typeof from[name] === 'object') {
			if (typeof dest[name] !== 'object') {
				dest[name] = {}
			}
			extend(dest[name],from[name]);
		} else {
			destination = Object.getOwnPropertyDescriptor(from, name);
			Object.defineProperty(dest, name, destination);
		}
	});
}

module.exports = config;