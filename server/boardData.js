/**
 *                  WHITEBOPHIR SERVER
 *********************************************************
 * @licstart  The following is the entire license notice for the 
 *  JavaScript code in this page.
 *
 * Copyright (C) 2013-2014  Ophir LOJKINE
 *
 *
 * The JavaScript code in this page is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License (GNU GPL) as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.  The code is distributed WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * @licend
 * @module boardData
 */

var fs = require('fs'),
	path = require("path"),
	util = require("util"),
	events = require("events");

/** @constant
    @type {string}
    @default
    Path to the file where boards will be saved by default
*/
var HISTORY_DIR = path.join(__dirname, "../server-data/");

/** @constant
    @type {Number}
    @default
    Number of seconds of inactivity after which the board should be saved to a file
*/
var SAVE_INTERVAL = 1000 * 2; // Save after 2 seconds of inactivity
var MAX_SAVE_DELAY = 1000 * 60; // Save after 60 seconds even if there is still activity
var MAX_ITEM_COUNT = 65536; // Max number of items to keep in the board
var MAX_CHILDREN = 128; // Max number of subitems in an item
var MAX_BOARD_SIZE = 65536; // Maximum value for any x or y on the board

/**
 * Represents a board.
 * @constructor
 */
var BoardData = function (name) {
	var that = this;
	this.name = name;
	this.board = {};
	this.ready = false;
	this.file = path.join(HISTORY_DIR, "board-" + encodeURIComponent(name) + ".json");
	this.lastSaveDate = Date.now();

	//Loads the file. This will emit the "ready" event
	this.load(this.file);

	this.on("ready", function () {
		that.ready = true;
	});
};

//Allows to use BoardData.emit() and BoardData.on()
util.inherits(BoardData, events.EventEmitter);

/** Adds data to the board */
BoardData.prototype.set = function (id, data) {
	//KISS
	this.validate(data);
	this.board[id] = data;
	this.delaySave();
};

/** Adds a child to an element that is already in the board
 * @param {string} id - Identifier of the parent element.
 * @param {object} child - Object containing the the values to update.
 * @param {boolean} [create=true] - Whether to create an empty parent if it doesn't exist
 * @returns {boolean} - True if the child was added, else false
*/
BoardData.prototype.addChild = function (parentId, child, create) {
	if (create === undefined) create = true;
	var obj = this.board[parentId];
	if (typeof obj !== "object") {
		if (create) obj = this.board[parentId] = {};
		else return false;
	}
	if (Array.isArray(obj._children)) obj._children.push(child);
	else obj._children = [child];

	this.validate(obj);
	this.delaySave();
	return true;
};

/** Update the data in the board
 * @param {string} id - Identifier of the data to update.
 * @param {object} data - Object containing the the values to update.
 * @param {boolean} create - True if the object should be created if it's not currently in the DB.
*/
BoardData.prototype.update = function (id, data, create) {
	var obj = this.board[id];
	if (typeof obj === "object") {
		for (var i in data) {
			obj[i] = data[i];
		}
	} else if (create || obj !== undefined) {
		this.board[id] = data;
	}
	this.delaySave();
};

/** Removes data from the board
 * @param {string} id - Identifier of the data to delete.
 */
BoardData.prototype.delete = function (id) {
	//KISS
	delete this.board[id];
	this.delaySave();
};

/** Reads data from the board
 * @param {string} id - Identifier of the element to get.
 * @returns {object} The element with the given id, or undefined if no element has this id
 */
BoardData.prototype.get = function (id, children) {
	return this.board[id];
};

/** Reads data from the board
 * @param {string} [id] - Identifier of the first element to get.
 * @param {BoardData~processData} callback - Function to be called with each piece of data read
 */
BoardData.prototype.getAll = function (id) {
	var results = [];
	for (var i in this.board) {
		if (!id || i > id) {
			results.push(this.board[i]);
		}
	}
	return results;
};

/**
 * This callback is displayed as part of the BoardData class.
 * Describes a function that processes data that comes from the board
 * @callback BoardData~processData
 * @param {object} data
 */


/** Delays the triggering of auto-save by SAVE_INTERVAL seconds
*/
BoardData.prototype.delaySave = function (file) {
	if (this.saveTimeoutId !== undefined) clearTimeout(this.saveTimeoutId);
	this.saveTimeoutId = setTimeout(this.save.bind(this), SAVE_INTERVAL);
	if (Date.now() - this.lastSaveDate > MAX_SAVE_DELAY) setTimeout(this.save.bind(this), 0);
};

/** Saves the data in the board to a file.
 * @param {string} [file=this.file] - Path to the file where the board data will be saved.
*/
BoardData.prototype.save = function (file) {
	this.lastSaveDate = Date.now();
	this.clean();
	if (!file) file = this.file;
	var board_txt = JSON.stringify(this.board);
	var that = this;
	fs.writeFile(file, board_txt, function onBoardSaved(err) {
		if (err) {
			console.trace(new Error("Unable to save the board: " + err));
		} else {
			console.log("Successfully saved board: " + that.name);
		}
	});
};

/** Remove old elements from the board */
BoardData.prototype.clean = function cleanBoard() {
	var toDestroy = Object.keys(this.board)
		.sort((x, y) => x.slice(1) < y.slice(1) ? -1 : 1)
		.slice(0, -MAX_ITEM_COUNT);
	for (var i = 0; i < toDestroy.length; i++) {
		delete this.board[toDestroy[i]];
	}
	if (toDestroy.length > 0) console.log("Cleaned " + toDestroy.length + " items in " + this.name);
}

/** Reformats an item if necessary in order to make it follow the boards' policy 
 * @param {object} item The object to edit
 * @param {object} parent The parent of the object to edit
*/
BoardData.prototype.validate = function validate(item, parent) {
	if (item.hasOwnProperty("size")) {
		item.size = parseInt(item.size) || 1;
		item.size = Math.min(Math.max(item.size, 1), 50);
	}
	if (item.hasOwnProperty("x") || item.hasOwnProperty("y")) {
		item.x = parseInt(item.x) || 0;
		item.x = Math.min(Math.max(item.x, 0), MAX_BOARD_SIZE);
		item.y = parseInt(item.y) || 0;
		item.y = Math.min(Math.max(item.y, 0), MAX_BOARD_SIZE);
	}
	if (item.hasOwnProperty("_children")) {
		if (!Array.isArray(item._children)) item._children = [];
		if (item._children.length > MAX_CHILDREN) item._children.length = MAX_CHILDREN;
		for (var i = 0; i < item._children.length; i++) {
			this.validate(item._children[i]);
		}
	}
}

/** Load the data in the board from a file.
 * @param {string} file - Path to the file where the board data will be read.
*/
BoardData.prototype.load = function (file) {
	var that = this;
	fs.readFile(file, function (err, data) {
		try {
			if (err) throw err;
			that.board = JSON.parse(data);
			for (id in that.board) that.validate(that.board[id]);
			console.log(that.name + " loaded from file.");
		} catch (e) {
			console.error("Unable to read history from " + file + ". The following error occured: " + e);
			console.log("Creating an empty board.");
			that.board = {}
		}
		that.emit("ready");
	});
};

module.exports.BoardData = BoardData;
