require('dotenv').config();
const util = require('util');
util.inspect.defaultOptions = {compact:false,breakLength:Infinity};

const { RTMClient, WebClient } = require('@slack/client');
var request = require('request');

const rtm = new RTMClient(process.env.token);
const web = new WebClient(process.env.token);

var lang = require('./lang.json');
var multiManager = require('./wiki_manager.json');

var isDebug = ( process.argv[2] === 'debug' ? true : false );
const access = {'PRIVATE-TOKEN': process.env.access};
const timeoptions = {
	year: 'numeric',
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	timeZone: 'UTC',
	timeZoneName: 'short'
}

var trysettings = 1;
var botsettings = {"default":"help"};

function getSettings() {
	request( {
		uri: process.env.read + process.env.file + process.env.raw,
		headers: access,
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || body.message || body.error ) {
			console.log( '- ' + trysettings + '. Fehler beim Erhalten der Einstellungen' + ( error ? ': ' + error : ( body ? ( body.message ? ': ' + body.message : ( body.error ? ': ' + body.error : '.' ) ) : '.' ) ) );
			if ( trysettings < 10 ) {
				trysettings++;
				getSettings();
			}
		}
		else {
			console.log( '- Einstellungen erfolgreich ausgelesen.' );
			botsettings = Object.assign({}, body);
		}
	} );
}

var allSites = [];

function getAllSites() {
	request( {
		uri: 'https://help.gamepedia.com/api.php?action=allsites&formatversion=2&do=getSiteStats&filter=wikis|wiki_domain,wiki_display_name,wiki_managers,official_wiki,created,ss_good_articles,ss_total_pages,ss_total_edits,ss_active_users&format=json',
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || body.status !== 'okay' || !body.data || !body.data.wikis ) {
			console.log( '- Fehler beim Erhalten der Wikis' + ( error ? ': ' + error : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
		}
		else {
			console.log( '- Wikis erfolgreich ausgelesen.' );
			allSites = Object.assign([], body.data.wikis.filter( site => /^[a-z\d-]{1,30}\.gamepedia\.com$/.test(site.wiki_domain) ));
			allSites.filter( site => site.wiki_domain in multiManager ).forEach( function(site) {
				site.wiki_managers = multiManager[site.wiki_domain].concat(site.wiki_managers).filter( (value, index, self) => self.indexOf(value) === index );
			} );
			allSites.filter( site => site.wiki_managers.length === 0 ).forEach( site => site.wiki_managers.push('MediaWiki default') );
		}
	} );
}

rtm.on('connected', function() {
	console.log( '- Erfolgreich angemeldet!' );
	getSettings();
	getAllSites();
});


function cmd_setwiki(channel, line, args, wiki) {
	if ( args[0] ) {
		var regex = /^(?:https:\/\/)?([a-z\d-]{1,50})/
		if ( regex.test(args[0].toLowerCase()) ) {
			var wikinew = regex.exec(args[0].toLowerCase())[1];
			if ( botsettings[channel] == wikinew ) {
				web.chat.postMessage({ channel, text: lang.setwiki.already + ' ' + wiki + '.gamepedia.com/' });
			}
			else {
				var temp_settings = Object.assign({}, botsettings);
				temp_settings[channel] = wikinew;
				request.post( {
					uri: process.env.save,
					headers: access,
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
						web.chat.postMessage({ channel, text: lang.setwiki.error });
					}
					else {
						botsettings = Object.assign({}, temp_settings);
						console.log( 'Einstellungen erfolgreich aktualisiert.' );
						web.chat.postMessage({ channel, text: lang.setwiki.changed + ' ' + botsettings[channel] + '.gamepedia.com/' });
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

async function cmd_eval(msg, channel, line, args, wiki) {
	if ( args.length ) {
		try {
			var text = util.inspect( await eval( args.join(' ') ) );
		} catch ( error ) {
			var text = error.name + ': ' + error.message;
		}
		console.log( '--- EVAL START ---\n\u200b' + text.replace( /\n/g, '\n\u200b' ) + '\n--- EVAL END ---' );
		if ( text.length > 4000 ) web.chat.postMessage({ channel, text: 'Long text' }).catch( err => web.chat.postMessage({ channel, text: err.name + ': ' + err.message }) );
		else web.chat.postMessage({ channel, text: '```\n' + text + '\n```' }).catch( err => web.chat.postMessage({ channel, text: err.name + ': ' + err.message }) );
	} else {
		cmd_link(channel, line.split(' ').slice(1).join(' '), wiki, ' ');
	}
}

function cmd_link(channel, title, wiki, cmd) {
	var invoke = title.split(' ')[0].toLowerCase();
	var args = title.split(' ').slice(1);
	
	if ( ( invoke == 'random' || invoke == '🎲' ) && !args.join('') ) cmd_random(channel, wiki);
	else if ( invoke == 'page' ) web.chat.postMessage({ channel, text: wiki + '.gamepedia.com/' + args.join('_').toTitle() });
	else if ( invoke == 'search' ) web.chat.postMessage({ channel, text: wiki + '.gamepedia.com/Special:Search/' + args.join('_').toTitle() });
	else if ( invoke == 'diff' ) cmd_diff(channel, args, wiki);
	else if ( title.includes( '#' ) ) web.chat.postMessage({ channel, text: wiki + '.gamepedia.com/' + title.split('#')[0].toTitle() + '#' + title.split('#').slice(1).join('#').toSection() });
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
				if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) web.chat.postMessage({ channel, text: lang.search.nowiki });
				else web.chat.postMessage({ channel, text: lang.search.error + ' ' + wiki + '.gamepedia.com/Special:Search/' + title.toTitle() });
			}
			else {
				if ( body.query.pages ) {
					if ( body.query.pages['-1'] && ( ( body.query.pages['-1'].missing != undefined && body.query.pages['-1'].known == undefined ) || body.query.pages['-1'].invalid != undefined ) ) {
						request( {
							uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&list=search&srnamespace=0|4|12|14|10000|10002|10004|10006|10008|10010&srsearch=' + encodeURI( title ) + '&srlimit=1',
							json: true
						}, function( srerror, srresponse, srbody ) {
							if ( srerror || !srresponse || !srbody || !srbody.query || ( !srbody.query.search[0] && srbody.query.searchinfo.totalhits != 0 ) ) {
								console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( srerror ? ': ' + srerror.message : ( srbody ? ( srbody.error ? ': ' + srbody.error.info : '.' ) : '.' ) ) );
								web.chat.postMessage({ channel, text: lang.search.error + ' ' + wiki + '.gamepedia.com/Special:Search/' + title.toTitle() });
							}
							else {
								if ( srbody.query.searchinfo.totalhits == 0 ) {
									web.chat.postMessage({ channel, text: lang.search.noresult.replaceSave( '%s', '`' + title + '`' ) + ' ' + wiki + '.gamepedia.com/' });
								}
								else if ( srbody.query.searchinfo.totalhits == 1 ) {
									web.chat.postMessage({ channel, text: wiki + '.gamepedia.com/' + srbody.query.search[0].title.toTitle() + '\n' + lang.search.infopage.replaceSave( '%s', '`' + process.env.prefix + cmd + 'page ' + title + '`' ) });
								}
								else {
									web.chat.postMessage({ channel, text: wiki + '.gamepedia.com/' + srbody.query.search[0].title.toTitle() + '\n' + lang.search.infosearch.replaceSave( '%1$s', '`' + process.env.prefix + cmd + 'page ' + title + '`' ).replaceSave( '%2$s', '`' + process.env.prefix + cmd + 'search ' + title + '`' ) });
								}
							}
						} );
					}
					else {
						web.chat.postMessage({ channel, text: wiki + '.gamepedia.com/' + Object.values(body.query.pages)[0].title.toTitle() + ( body.query.redirects && body.query.redirects[0].tofragment ? '#' + body.query.redirects[0].tofragment.toSection() : '' ) });
					}
				}
				else if ( body.query.interwiki ) {
					var inter = body.query.interwiki[0];
					var intertitle = inter.title.substr(inter.iw.length+1);
					var regex = /^(?:https?:)?\/\/(.*)\.gamepedia\.com\//.exec(inter.url);
					if ( regex != null ) {
						var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
						cmd_link(channel, iwtitle, regex[1], ' !' + regex[1] + ' ');
					} else web.chat.postMessage({ channel, text: inter.url });
				}
				else {
					web.chat.postMessage({ channel, text: wiki + '.gamepedia.com/' + body.query.general.mainpage.toTitle() });
				}
			}
		} );
	}
}

function cmd_user(channel, username, wiki, title) {
	if ( !username || username.includes( '/' ) || username.toLowerCase().startsWith('talk:') ) {
		web.chat.postMessage({ channel, text: wiki + '.gamepedia.com/' + title });
	} else {
		request( {
			uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&list=users&usprop=blockinfo|groups|editcount|registration|gender&ususers=' + encodeURI( username ),
			json: true
		}, function( error, response, body ) {
			if ( error || !response || !body || !body.query || !body.query.users[0] ) {
				console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
				if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) web.chat.postMessage({ channel, text: lang.search.nowiki });
				else web.chat.postMessage({ channel, text: lang.search.error + ' ' + wiki + '.gamepedia.com/User:' + username });
			}
			else {
				if ( body.query.users[0].missing == "" || body.query.users[0].invalid == "" ) {
					web.chat.postMessage({ channel, text: lang.user.nouser });
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
					web.chat.postMessage({ channel, text: wiki + '.gamepedia.com/UserProfile:' + username + '\n\n' + lang.user.info.replaceSave( '%1$s', gender ).replaceSave( '%2$s', registration ).replaceSave( '%3$s', editcount ).replaceSave( '%4$s', group ) + ( isBlocked ? '\n\n' + lang.user.blocked.replaceSave( '%1$s', blockedtimestamp ).replaceSave( '%2$s', blockexpiry ).replaceSave( '%3$s', blockedby ).replaceSave( '%4$s', blockreason.wikicode() ) : '' ) });
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
		var diff = 0;
		var relative = 'prev';
		if ( /^\d+$/.test(args[0]) ) {
			revision = args[0];
			if ( args[1] ) {
				if ( /^\d+$/.test(args[1]) ) {
					diff = args[1];
				}
				else if ( args[1] == 'prev' || args[1] == 'next' || args[1] == 'cur' ) {
					relative = args[1];
				}
				else error = true;
			}
		}
		else if ( args[0] == 'prev' || args[0] == 'next' || args[0] == 'cur' ) {
			relative = args[0];
			if ( args[1] ) {
				if ( /^\d+$/.test(args[1]) ) {
					revision = args[1];
				}
				else error = true;
			}
			else error = true;
		}
		else title = args.join('_').replace( /\?/g, '%3F' );
		
		if ( error ) web.chat.postMessage({ channel, text: lang.diff.invalid });
		else if ( diff ) {
			var argids = [];
			if ( parseInt(revision, 10) > parseInt(diff, 10) ) argids = [revision, diff];
			else if ( parseInt(revision, 10) == parseInt(diff, 10) ) argids = [revision];
			else argids = [diff, revision];
			cmd_diffsend(channel, argids, wiki);
		}
		else {
			request( {
				uri: 'https://' + wiki + '.gamepedia.com/api.php?action=compare&format=json&prop=ids' + ( title ? '&fromtitle=' + title : '&fromrev=' + revision ) + '&torelative=' + relative,
				json: true
			}, function( error, response, body ) {
				if ( error || !response || !body || ( !body.compare && body.error.code != 'nosuchrevid' ) ) {
					console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
					if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) web.chat.postMessage({ channel, text: lang.search.nowiki });
					else web.chat.postMessage({ channel, text: lang.search.error + ' ' + wiki + '.gamepedia.com/' + title + '?diff=' + relative + ( title ? '' : '&oldid=' + revision ) });
				}
				else {
					if ( body.error && body.error.code == 'nosuchrevid' ) web.chat.postMessage({ channel, text: lang.diff.badrev });
					else if ( body.compare.fromarchive != undefined || body.compare.toarchive != undefined ) web.chat.postMessage({ channel, text: lang.error });
					else {
							var argids = [];
							var ids = body.compare;
							if ( ids.fromrevid && !ids.torevid ) argids = [ids.fromrevid];
							else if ( !ids.fromrevid && ids.torevid ) argids = [ids.torevid];
							else if ( ids.fromrevid > ids.torevid ) argids = [ids.fromrevid, ids.torevid];
							else if ( ids.fromrevid == ids.torevid ) argids = [ids.fromrevid];
							else argids = [ids.torevid, ids.fromrevid];
						cmd_diffsend(channel, argids, wiki);
					}
				}
			} );
		}
	}
	else web.chat.postMessage({ channel, text: lang.error });
}

function cmd_diffsend(channel, args, wiki) {
	request( {
		uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&list=tags&tglimit=500&tgprop=displayname&prop=revisions&rvprop=ids|timestamp|flags|user|size|comment|tags&revids=' + args.join('|'),
		json: true
	}, function( error, response, body ) {
		if ( error || !response || !body || !body.query ) {
			console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
			if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) web.chat.postMessage({ channel, text: lang.search.nowiki });
			else web.chat.postMessage({ channel, text: lang.search.error + ' ' + wiki + '.gamepedia.com/?diff=' + args[0] + ( args[1] ? '&oldid=' + args[1] : '' ) });
		}
		else {
			if ( body.query.badrevids ) web.chat.postMessage({ channel, text: lang.diff.badrev });
			else if ( body.query.pages && !body.query.pages['-1'] ) {
				var pages = Object.values(body.query.pages);
				if ( pages.length != 1 ) web.chat.postMessage({ channel, text: wiki + '.gamepedia.com/?diff=' + args[0] + ( args[1] ? '&oldid=' + args[1] : '' ) });
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
						
					web.chat.postMessage({ channel, text: wiki + '.gamepedia.com/' + title + '?diff=' + diff + '&oldid=' + oldid + '\n\n' + lang.diff.info.replaceSave( '%1$s', editor ).replaceSave( '%2$s', timestamp ).replaceSave( '%3$s', size ).replaceSave( '%4$s', comment.wikicode() ).replaceSave( '%5$s', tags.join(', ').replace( /<[^>]+>(.+)<\/[^>]+>/g, '$1' ) ) });
				}
			}
			else web.chat.postMessage({ channel, text: lang.error });
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
			if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) web.chat.postMessage({ channel, text: lang.search.nowiki });
			else web.chat.postMessage({ channel, text: lang.search.error + ' ' + wiki + '.gamepedia.com/Special:Random' });
		}
		else {
			web.chat.postMessage({ channel, text: '🎲 ' + wiki + '.gamepedia.com/' + body.query.random[0].title.toTitle() });
		}
		
	} );
}

String.prototype.toTitle = function() {
	return this.replace( / /g, '_' ).replace( /\%/g, '%25' ).replace( /\?/g, '%3F' );
};

String.prototype.toSection = function() {
	return encodeURIComponent( this.replace( / /g, '_' ) ).replace( /\'/g, '%27' ).replace( /\(/g, '%28' ).replace( /\)/g, '%29' ).replace( /\%/g, '.' );
};

String.prototype.wikicode = function(wiki) {
	return this.replace( /\[\[(?:[^\|\]]+\|)?([^\]]+)\]\]/g, '$1' ).replace( /\/\*\s*([^\*]+?)\s*\*\//g, '→$1:' );
};

String.prototype.replaceSave = function(pattern, replacement) {
	return this.replace( pattern, ( typeof replacement === 'string' ? replacement.replace( '$', '$$$$' ) : replacement ) );
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
			else if ( invoke == 'eval' && user == process.env.owner ) cmd_eval(message, channel, line, args, wiki);
			else if ( invoke.startsWith('!') ) cmd_link(channel, args.join(' '), invoke.substr(1), ' ' + invoke + ' ');
			else cmd_link(channel, line.split(' ').slice(1).join(' '), wiki, ' ');
		}
	} );
} );

rtm.start();
