const fs = require('fs');

const { RTMClient } = require('@slack/client');
var request = require('request');

const rtm = new RTMClient(process.env.token);

var lang = JSON.parse(fs.readFileSync('lang.json', 'utf8'));

var trysettings = 0;
var botsettings = {};

function getSettings() {
	request( {
		uri: process.env.read + process.env.file + process.env.access,
		json: true
	}, function( error, response, body ) {
		if ( error || !response || !body || body.error ) {
			console.log( trysettings + '. Fehler beim Erhalten der Einstellungen' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error : '.' ) : '.' ) ) );
			if ( trysettings < 10 ) {
				trysettings++;
				getSettings();
			}
		}
		else {
			console.log( 'Einstellungen erfolgreich ausgelesen.' );
			botsettings = Object.assign({}, body);
		}
	} );
}

rtm.on('connected', function() {
	console.log( 'Erfolgreich angemeldet!' );
	getSettings();
});


function cmd_setwiki(channel, line, args, wiki) {
	if ( args[0] ) {
		var regex = /^(?:(?:https?:)?\/\/)?([a-z\d-]{1,30})/
		if ( regex.test(args[0].toLowerCase()) ) {
			var wikinew = regex.exec(args[0].toLowerCase())[1];
			if ( botsettings[channel] == wikinew ) {
				rtm.sendMessage( lang.setwiki.already + ' https://' + wiki + '.gamepedia.com/', channel );
			}
			else {
				var temp_settings = Object.assign({}, botsettings);
				temp_settings[channel] = wikinew;
				request.post( {
					uri: process.env.save + process.env.access,
					body: {
						branch: 'master',
						commit_message: 'Slack: Einstellungen aktualisiert.',
						actions: [
							{
								action: 'update',
								file_path: process.env.file,
								content: JSON.stringify( temp_settings, null, '\t' )
							}
						]
					},
					json: true
				}, function( error, response, body ) {
					if ( error || !response || response.statusCode != 201 || !body || body.error ) {
						console.log( 'Fehler beim Bearbeiten' + ( error ? ': ' + error.message : ( body ? ( body.message ? ': ' + body.message : ( body.error ? ': ' + body.error : '.' ) ) : '.' ) ) );
						rtm.sendMessage( lang.setwiki.error, channel );
					}
					else {
						botsettings = Object.assign({}, temp_settings);
						console.log( 'Einstellungen erfolgreich aktualisiert.' );
						rtm.sendMessage( lang.setwiki.changed + ' https://' + botsettings[channel] + '.gamepedia.com/', channel );
					}
				} );
			}
		}
		else {
			cmd_link(channel, line.split(' ').slice(1).join(' '), wiki, ' ');
		}
	}
	else {
		cmd_link(channel, line.split(' ').slice(1).join(' '), wiki, ' ');
	}
}

function cmd_link(channel, title, wiki, cmd) {
	var invoke = title.split(' ')[0].toLowerCase();
	var args = title.split(' ').slice(1);
	
	if ( ( invoke == 'random' || invoke == '🎲' ) && !args.join('') ) cmd_random(channel, wiki);
	else if ( invoke == 'page' ) rtm.sendMessage( 'https://' + wiki + '.gamepedia.com/' + args.join('_').toTitle(), channel );
	else if ( invoke == 'search' ) rtm.sendMessage( 'https://' + wiki + '.gamepedia.com/Special:Search/' + args.join('_').toTitle(), channel );
	else if ( invoke == 'diff' ) cmd_diff(channel, args, wiki);
	else if ( title.includes( '#' ) ) rtm.sendMessage( 'https://' + wiki + '.gamepedia.com/' + title.split('#')[0].toTitle() + '#' + title.split('#').slice(1).join('#').toSection(), channel );
	else if ( invoke == 'user' ) cmd_user(channel, args.join('_').toTitle(), wiki, title.toTitle());
	else if ( invoke.startsWith('user:') ) cmd_user(channel, title.substr(5).toTitle(), wiki, title.toTitle());
	else if ( invoke.startsWith('userprofile:') ) cmd_user(channel, title.substr(12).toTitle(), wiki, title.toTitle());
	else {
		request( {
			uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&meta=siteinfo&siprop=general&iwurl=true&redirects=true&titles=' + encodeURI( title ),
			json: true
		}, function( error, response, body ) {
			if ( error || !response || !body || !body.query ) {
				console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
				if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) rtm.sendMessage( lang.search.nowiki, channel );
				else rtm.sendMessage( lang.search.error + ' https://' + wiki + '.gamepedia.com/Special:Search/' + title.toTitle(), channel );
			}
			else {
				if ( body.query.pages ) {
					if ( body.query.pages['-1'] && body.query.pages['-1'].missing != undefined ) {
						request( {
							uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&list=search&srnamespace=0|4|12|14|10000|10002|10004|10006|10008|10010&srsearch=' + encodeURI( title ) + '&srlimit=1',
							json: true
						}, function( srerror, srresponse, srbody ) {
							if ( srerror || !srresponse || !srbody || !srbody.query || ( !srbody.query.search[0] && srbody.query.searchinfo.totalhits != 0 ) ) {
								console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( srerror ? ': ' + srerror.message : ( srbody ? ( srbody.error ? ': ' + srbody.error.info : '.' ) : '.' ) ) );
								rtm.sendMessage( lang.search.error + ' https://' + wiki + '.gamepedia.com/Special:Search/' + title.toTitle(), channel );
							}
							else {
								if ( srbody.query.searchinfo.totalhits == 0 ) {
									rtm.sendMessage( lang.search.noresult.replace( '%s', '`' + title + '`' ) + ' https://' + wiki + '.gamepedia.com/', channel );
								}
								else if ( srbody.query.searchinfo.totalhits == 1 ) {
									rtm.sendMessage( 'https://' + wiki + '.gamepedia.com/' + srbody.query.search[0].title.toTitle() + '\n' + lang.search.infopage.replace( '%s', '`' + process.env.prefix + cmd + 'page ' + title + '`' ), channel );
								}
								else {
									rtm.sendMessage( 'https://' + wiki + '.gamepedia.com/' + srbody.query.search[0].title.toTitle() + '\n' + lang.search.infosearch.replace( '%1$s', '`' + process.env.prefix + cmd + 'page ' + title + '`' ).replace( '%2$s', '`' + process.env.prefix + cmd + 'search ' + title + '`' ), channel );
								}
							}
						} );
					}
					else {
						rtm.sendMessage( 'https://' + wiki + '.gamepedia.com/' + Object.values(body.query.pages)[0].title.toTitle() + ( body.query.redirects && body.query.redirects[0].tofragment ? '#' + body.query.redirects[0].tofragment.toSection() : '' ), channel );
					}
				}
				else if ( body.query.interwiki ) {
					var inter = body.query.interwiki[0];
					var intertitle = inter.title.substr(inter.iw.length+1);
					var regex = /^(?:https?:)?\/\/(.*)\.gamepedia\.com\//.exec(inter.url);
					if ( regex != null ) {
						var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replace( intertitle.replace( /\_/g, ' ' ), intertitle );
						cmd_link(channel, iwtitle, regex[1], ' !' + regex[1] + ' ');
					} else rtm.sendMessage( inter.url, channel );
				}
				else {
					rtm.sendMessage( 'https://' + wiki + '.gamepedia.com/' + body.query.general.mainpage.toTitle(), channel );
				}
			}
		} );
	}
}

function cmd_user(channel, username, wiki, title) {
	if ( !username || username.includes( '/' ) || username.toLowerCase().startsWith('talk:') ) {
		rtm.sendMessage( 'https://' + wiki + '.gamepedia.com/' + title, channel );
	} else {
		request( {
			uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&list=users&usprop=blockinfo|groups|editcount|registration|gender&ususers=' + encodeURI( username ),
			json: true
		}, function( error, response, body ) {
			if ( error || !response || !body || !body.query || !body.query.users[0] ) {
				console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
				if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) rtm.sendMessage( lang.search.nowiki, channel );
				else rtm.sendMessage( lang.search.error + ' https://' + wiki + '.gamepedia.com/User:' + username, channel );
			}
			else {
				if ( body.query.users[0].missing == "" || body.query.users[0].invalid == "" ) {
					rtm.sendMessage( lang.user.nouser, channel );
				}
				else {
					username = body.query.users[0].name.replace( / /g, '_' );
					var timeoptions = {
						year: 'numeric',
						month: 'short',
						day: 'numeric',
						hour: '2-digit',
						minute: '2-digit',
						timeZone: 'UTC',
						timeZoneName: 'short'
					}
					var gender = body.query.users[0].gender;
					switch (gender) {
						case 'male':
							gender = lang.user.gender.male;
							break;
						case 'female':
							gender = lang.user.gender.female;
							break;
						default: 
							gender = lang.user.gender.unknown;
					}
					var registration = (new Date(body.query.users[0].registration)).toLocaleString(lang.user.dateformat, timeoptions);
					var editcount = body.query.users[0].editcount;
					var groups = body.query.users[0].groups;
					var group = '';
					for ( var i = 0; i < lang.user.group.length; i++ ) {
						if ( groups.includes(lang.user.group[i][0]) ) {
							group = lang.user.group[i][1];
							break;
						}
					}
					var isBlocked = false;
					var blockedtimestamp = (new Date(body.query.users[0].blockedtimestamp)).toLocaleString(lang.user.dateformat, timeoptions);
					var blockexpiry = body.query.users[0].blockexpiry;
					if ( blockexpiry == 'infinity' ) {
						blockexpiry = lang.user.until_infinity;
						isBlocked = true;
					} else if ( blockexpiry ) {
						var blockexpirydate = blockexpiry.replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2,3})/, '$1-$2-$3T$4:$5:$6Z');
						blockexpiry = (new Date(blockexpirydate)).toLocaleString(lang.user.dateformat, timeoptions);
						if ( Date.parse(blockexpirydate) > Date.now() ) isBlocked = true;
					}
					var blockedby = body.query.users[0].blockedby;
					var blockreason = body.query.users[0].blockreason;
					rtm.sendMessage( 'https://' + wiki + '.gamepedia.com/UserProfile:' + username + '\n\n' + lang.user.info.replace( '%1$s', gender ).replace( '%2$s', registration ).replace( '%3$s', editcount ).replace( '%4$s', group ) + ( isBlocked ? '\n\n' + lang.user.blocked.replace( '%1$s', blockedtimestamp ).replace( '%2$s', blockexpiry ).replace( '%3$s', blockedby ).replace( '%4$s', blockreason.wikicode() ) : '' ), channel );
				}
			}
		} );
	}
}

function cmd_diff(channel, args, wiki) {
	if ( args[0] ) {
		var error = false;
		var title = '';
		var revision = 0;
		var diff = 'prev';
		if ( /^\d+$/.test(args[0]) ) {
			revision = args[0];
			if ( args[1] ) {
				if ( /^\d+$/.test(args[1]) ) {
					diff = args[1];
				}
				else if ( args[1] == 'prev' || args[1] == 'next' ) {
					diff = args[1];
				}
				else error = true;
			}
		}
		else if ( args[0] == 'prev' || args[0] == 'next' ) {
			diff = args[0];
			if ( args[1] ) {
				if ( /^\d+$/.test(args[1]) ) {
					revision = args[1];
				}
				else error = true;
			}
			else error = true;
		}
		else title = args.join('_').replace( /\?/g, '%3F' );
		
		if ( error ) rtm.sendMessage( lang.diff.invalid, channel );
		else if ( /^\d+$/.test(diff) ) {
			var argids = [];
			if ( parseInt(revision, 10) > parseInt(diff, 10) ) argids = [revision, diff];
			else if ( parseInt(revision, 10) == parseInt(diff, 10) ) argids = [revision];
			else argids = [diff, revision];
			cmd_diffsend(channel, argids, wiki);
		}
		else {
			request( {
				uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&prop=revisions&rvprop=' + ( title ? '&titles=' + title : '&revids=' + revision ) + '&rvdiffto=' + diff,
				json: true
			}, function( error, response, body ) {
				if ( error || !response || !body || !body.query ) {
					console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
					if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) rtm.sendMessage( lang.search.nowiki, channel );
					else rtm.sendMessage( lang.search.error + ' https://' + wiki + '.gamepedia.com/' + title + '?diff=' + diff + ( title ? '' : '&oldid=' + revision ), channel );
				}
				else {
					if ( body.query.badrevids ) rtm.sendMessage( lang.diff.badrev, channel );
					else if ( body.query.pages && body.query.pages[-1] ) rtm.sendMessage( 'This page does not exist!', channel );
					else if ( body.query.pages ) {
						var argids = [];
						var ids = Object.values(body.query.pages)[0].revisions[0].diff;
						if ( ids.from ) {
							if ( ids.from > ids.to ) argids = [ids.from, ids.to];
							else if ( ids.from == ids.to ) argids = [ids.to];
							else argids = [ids.to, ids.from];
						}
						else argids = [ids.to];
						cmd_diffsend(channel, argids, wiki);
					}
					else rtm.sendMessage( lang.error, channel );
				}
			} );
		}
	}
	else rtm.sendMessage( lang.error, channel );
}

function cmd_diffsend(channel, args, wiki) {
	request( {
		uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&list=tags&tglimit=500&tgprop=displayname&prop=revisions&rvprop=ids|timestamp|flags|user|size|comment|tags&revids=' + args.join('|'),
		json: true
	}, function( error, response, body ) {
		if ( error || !response || !body || !body.query ) {
			console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
			if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) rtm.sendMessage( lang.search.nowiki, channel );
			else rtm.sendMessage( lang.search.error + ' https://' + wiki + '.gamepedia.com/?diff=' + args[0] + ( args[1] ? '&oldid=' + args[1] : '' ), channel );
		}
		else {
			if ( body.query.badrevids ) rtm.sendMessage( lang.diff.badrev, channel );
			else if ( body.query.pages ) {
				var pages = Object.values(body.query.pages);
				if ( pages.length != 1 ) rtm.sendMessage( 'https://' + wiki + '.gamepedia.com/?diff=' + args[0] + ( args[1] ? '&oldid=' + args[1] : '' ), channel );
				else {
					var title = pages[0].title.toTitle();
					var revisions = [];
					if ( pages[0].revisions[1] ) revisions = [pages[0].revisions[1], pages[0].revisions[0]];
					else revisions = [pages[0].revisions[0]];
					var diff = revisions[0].revid;
					var oldid = ( revisions[1] ? revisions[1].revid : 0 );
					var editor = ( revisions[0].userhidden != undefined ? lang.diff.hidden : revisions[0].user );
					var timeoptions = {
						year: 'numeric',
						month: 'short',
						day: 'numeric',
						hour: '2-digit',
						minute: '2-digit',
						timeZone: 'UTC',
						timeZoneName: 'short'
					}
					var timestamp = (new Date(revisions[0].timestamp)).toLocaleString(lang.user.dateformat, timeoptions);
					var size = revisions[0].size - ( revisions[1] ? revisions[1].size : 0 );
					var comment = ( revisions[0].commenthidden != undefined ? lang.diff.hidden : revisions[0].comment );
					if ( !comment ) comment = lang.diff.nocomment;
					var tags = [lang.diff.notags];
					var entry = body.query.tags;
					revisions[0].tags.forEach( function(tag, t) {
						for ( var i = 0; i < entry.length; i++ ) {
							if ( entry[i].name == tag ) {
								tags[t] = entry[i].displayname;
								break;
							}
						}
					} );
						
					rtm.sendMessage( 'https://' + wiki + '.gamepedia.com/' + title + '?diff=' + diff + '&oldid=' + oldid + '\n\n' + lang.diff.info.replace( '%1$s', editor ).replace( '%2$s', timestamp ).replace( '%3$s', size ).replace( '%4$s', comment.wikicode() ).replace( '%5$s', tags.join(', ').replace( /<[^>]+>(.+)<\/[^>]+>/g, '$1' ) ), channel );
				}
			}
			else rtm.sendMessage( lang.error, channel );
		}
		
	} );
}

function cmd_random(channel, wiki) {
	request( {
		uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&list=random&rnnamespace=0',
		json: true
	}, function( error, response, body ) {
		if ( error || !response || !body || !body.query || !body.query.random[0] ) {
			console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
			if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) rtm.sendMessage( lang.search.nowiki, channel );
			else rtm.sendMessage( lang.search.error + ' https://' + wiki + '.gamepedia.com/Special:Random', channel );
		}
		else {
			rtm.sendMessage( '🎲 https://' + wiki + '.gamepedia.com/' + body.query.random[0].title.toTitle(), channel );
		}
		
	} );
}

String.prototype.toTitle = function() {
	return this.replace( / /g, '_' ).replace( /\%/g, '%25' ).replace( /\?/g, '%3F' );
};

String.prototype.toSection = function() {
	return encodeURIComponent( this.replace( / /g, '_' ) ).replace( /\'/g, '%27' ).replace( /\%/g, '.' );
};

String.prototype.wikicode = function(wiki) {
	return this.replace( /\[\[(?:[^\|\]]+\|)?([^\]]+)\]\]/g, '$1' ).replace( /\/\*\s*([^\*]+?)\s*\*\//g, '→$1:' );
};

rtm.on( 'message', function(message) {
	var cont = message.text;
	var user = message.user;
	var channel = message.channel;
	if ( message.subtype || message.thread_ts || !cont.toLowerCase().includes( process.env.prefix ) || user == rtm.activeUserId ) return;
	
	var wiki = ( botsettings[channel] ? botsettings[channel] : 'help' );
	cont.split('\n').forEach( function(line) {
		if ( line.toLowerCase().startsWith( process.env.prefix + ' ' ) || line.toLowerCase() == process.env.prefix ) {
			var invoke = line.split(' ')[1] ? line.split(' ')[1].toLowerCase() : '';
			var args = line.split(' ').slice(2);
			console.log( channel + ': ' + invoke + ' - ' + args );
			if ( invoke == 'setwiki' ) cmd_setwiki(channel, line, args, wiki);
			else if ( invoke.startsWith('!') ) cmd_link(channel, args.join(' '), invoke.substr(1), ' ' + invoke + ' ');
			else cmd_link(channel, line.split(' ').slice(1).join(' '), wiki, ' ');
		}
	} );
} );

rtm.start();
