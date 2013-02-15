function Logger() {
}

// Only calls the callback if debug logging is enabled.
Logger.prototype.ifDebugEnabled = function( callback ) {
	chrome.storage.local.get( 'ldengine_log_level', function( items ) {
		var LOG_LEVEL = items.ldengine_log_level || "off";
		if( LOG_LEVEL == "debug" )
			callback();
	} );
}
Logger.prototype.debug = function( message ) {
	this.ifDebugEnabled( function() {
		var time = new Date();
		setTimeout( function() {
			console.log( '*** ldengine.js: ' + time.getTime() + ': ' + message );
		}, 0 );
	});
}
var log = new Logger();

// Bootstrap
$(function() {
	log.debug( 'Starting Bootstrap Function' );
	$( document ).ajaxError( function( event, xhr, ajaxOptions, thrownError ) {
		log.debug( 'AJAX Error: ' + JSON.stringify( thrownError ) + ' in request ' + JSON.stringify( ajaxOptions ));
	});

	var checkForSidebarTimer = null;
	var checkForAdsTimer = null;
	var checkMessageLoadedTimer = null;
	var checkSidebarRetry;

	// When sidebar can we safely appended, immediately append it (spam until it's possible, then do it)
	throttledWaitUntil(LDEngine.sidebar.isReadyToBeAppended, LDEngine.sidebar.init, 25);

	// Start monitoring changes to browser history
	$(window).bind("popstate", function(event) {
		log.debug( 'Window popstate' );
		// On popstate, try to initialize the sidebar again

			waitUntil(LDEngine.sidebar.isReadyToBeAppended, LDEngine.sidebar.init, 25);
	});

	// Create a deferred object to wrap around a call to Chrome's
	// local storage API.  This lets us chain our request for
	// settings with our other startup requests

	function getSettings() {
		log.debug( 'getSettings()' );
		var getApiURLDeferredObj = $.Deferred();
		chrome.storage.local.get('ldengine_api_url', function(items) {

			// For now, to avoid any weird issues w/ people who already installed
			// the existing version, hard-code the production host
			// API_URL = "apps.ldengine.com";
			API_URL = items.ldengine_api_url || "https://apps.ldengine.com";
				if( API_URL.indexOf( "http" ) < 0 )
				 API_URL = "https://" + API_URL;

			getApiURLDeferredObj.resolve();
		});
		return getApiURLDeferredObj.promise();
	}

	// Load the settings and all of the html templates.
	$.when(getSettings()).then(function() {
		$.when($.get(chrome.extension.getURL("ldengine.tmpl"), function(data) {
			$.templates('ldengineTemplate', data);
		}, 'html'),
		$.get(chrome.extension.getURL("snippet.tmpl"), function(data) {
			$.templates('sidebarTemplate', data);
		}, 'html'),
		$.get(chrome.extension.getURL("popup.tmpl"), function(data) {
			$.templates('popupTemplate', data);
		}, 'html'),
		$.get(chrome.extension.getURL("unauthenticated.tmpl"), function(data) {
			$.templates('unauthTemplate', data);
		}, 'html'),
		$.get(chrome.extension.getURL("senderInfo.tmpl"), function(data) {
			$.templates('senderInfoTemplate', data);
		}, 'html'),
		// $.get(chrome.extension.getURL("noResonse.tmpl"), function(data) {
		// 	$.templates('noResonseTemplate', data);
		// }, 'html'),
		$.get(chrome.extension.getURL("noSnippets.tmpl"), function(data) {
			$.templates('noSnippetsTemplate', data);
		}, 'html')).then(function() {
			// Set global state that UI templates are ready
			templatesReady = true;
		});
	});
});

var API_URL;
var activeMessage = null;
var accountStatus;
var templatesReady = false;

// Shared alarm object for message scrape-readiness
var messageScrapeAlarm;


/**
 * @test - condition to check
 * @action - do something
 * @tryInterval - how often to try (default to 50ms)
 * @sharedTimer - if sharedTimer is specified, clear it when action is fired
 * @eachTime - function to run each time the condition is checked
 * returns timer
 */

function waitUntil(test, action, tryInterval, sharedTimer, eachTime) {
	log.debug( 'Wait until: ' + test.toString() );
	var timer = setInterval(function() {
		typeof eachTime === "function" && eachTime();
		if(test()) {
			clearInterval(timer);
			sharedTimer && clearInterval(sharedTimer);
			log.ifDebugEnabled( function() {
				log.debug( 'Condition met: ' + test.toString() );
				log.debug( 'Performing action: ' + action.toString() );
			});

			action();
		}
	}, tryInterval || 50);

	return timer;
}

// A version of waitUntil that won't fire more than once every five seconds
var throttledWaitUntil = _.throttle(waitUntil, 5000);



var Gmail = {

	selectors: {
		sidebar: '.y3',
		adbar: '.u5',
		userbar: '.nH:not(".adC")',
		message: {
			body     : '.adP',
			container: '.h7'
		}
	},

	message: {

		// Scrape the message data from the DOM
		scrape: function($el, callback) {
			log.debug( 'Scraping message data from DOM' );

			var thisMessageIsReadyToScrape = _.bind(Gmail.message.isReadyToScrape, this, $el);

			// When this message is loaded, scrape it
			// Use a global timer to prevent multiple clicks from firing multiple POSTs
			clearInterval(messageScrapeAlarm);
			messageScrapeAlarm = waitUntil(thisMessageIsReadyToScrape, function() {

				// Get the addresses of people this email was sent to
				var recipientEmails = _.map($el.find('.hb').find('[email]'), function(recipientEl) {
					return $(recipientEl).attr('email');
				});

				
				// Return api-ready object
				var messageData = {
					Message: {
						subject: $('.hP').text(),
						body: $el.find(Gmail.selectors.message.body).text().replace(/\n/g, ' '),
						// body: $el.find(Gmail.selectors.message.body).last().text().replace(/\n/g, ' '),
						from: $el.find('.gD').attr('email'),
						to: recipientEmails,
						mgid: 'null',
						thrid: 'null'
						// TODO: cc, bcc
					}
				}; 
				log.ifDebugEnabled( function() {
					log.debug( 'Message data scraped: ' + JSON.stringify( messageData ));
				} );
				callback(null, messageData );

			});
		},

		// Returns whether the *expanded* message is finished loading (and is therefore scrape-able)
		isReadyToScrape: function($el) {
			var ready = $el.find(Gmail.selectors.message.body).length;
			log.debug( 'isReadyToScrape?: ' + ready );
			return ready;
		},

		// Triggered when a message container is clicked
		click: function($el) {
			var isThisMessageReadyToScrape = _.bind(Gmail.message.isReadyToScrape, this, $el);

			// TODO: call scrape()
			log.ifDebugEnabled( function() {
				log.debug( 'Message Container Clicked, isThisMessageReadyToScrape?: ' + isThisMessageReadyToScrape );
				log.debug( 'TODO: "call scrape()"' );
			} );
		},

		// Bind a click event to each message
		bindClick: function() {
			// $('.kv,.hn,.h7').bind('click', clickMessageThread);
		},
		
		// POST the message object to the server
		post: function(messageApiObj, callback) {
			
			// Post the message to the server and get related snippets
			log.ifDebugEnabled( function() {
				debug.log( 'Posting message back to ' + API_URL + "/message/relatedMessages" );
			} );

			$.ajax(API_URL + "/message/relatedMessages", {
				type: 'POST',
				data: messageApiObj,
				success: callback,
				dataType: 'json'
			});
		}
	},

	constructOriginalUrl: {
		threadId: '&th=' ,
		userId: '&ik=',
		urlConstruct: function(userId, threadId, callback) { //order of operations: userIdScrape, threadIdParse, urlConstruct
			var url = 'https://mail.google.com/mail/?ui=2&view=om';	
			url += threadId;
			url += userId;
			callback(url);
		},
		userIdScrape: function(callback) {
			
			var UIDarray, UIDstring, userId;
				var xhr = new XMLHttpRequest();
				xhr.open("GET",document.location.href , true);
				xhr.onload = function() {
					var response = xhr.responseText 
					UIDarray = response.match(/\x2fmail\x2fu\x2f.*\x5b/i);
					var UIDstring = UIDarray.join();
					UIDstring = UIDstring.replace(/\x22/g, '');
					UIDstring = UIDstring.split(',');
					userId = UIDstring[2];
					callback(userId);
				};
			xhr.send();
		},
		threadIdParse: function(callback) {
			var currentUrl = document.location.href;
			var threadId;

			var threadArray = currentUrl.match(/inbox\x2f.*/i);
			var threadString = threadArray.join();
			threadString = threadString.split('\x2f');
			threadId =threadString[1];
			callback(threadId);

		},		   //meta function
		construct: function(callback) {
			var self = this;
			var UID = self.userId,
				THID = self.threadId;
			self.userIdScrape( function(userId) { 
				UID += userId; 
				self.threadIdParse( function(threadId) {
					THID += threadId;
					self.urlConstruct( UID,THID,function(url) {
						callback(url);
					} ); 
				} );
			} );
		}
	},
	scrapeMessageId: function(url, callback) {
		//someone smart and nitpicky could find a way to make a function for this
		// XMLRequestwithRegex function(regex match string[], regex replace character[], regex split character[]) 
		var MGIDarray, MGIDstring, messageId;
		var xhr = new XMLHttpRequest();
		xhr.open("GET",url,true);
		xhr.onload = function() { 
			var response = xhr.responseText;
			MGIDarray = response.match(/message-id: <.*>/i);
			MGIDstring = MGIDarray.join();
			MGIDstring = MGIDstring.replace(/<|>/g,'');
			MGIDstring = MGIDstring.split(" ");
			MGIDstring = MGIDstring[1].split("@");
			messageId = MGIDstring[0];
			callback(messageId);
		};
		xhr.send();
	}
};

// Bind objects so we can use *this*
_.bindAll(Gmail);
_.bindAll(Gmail.message);




var LDEngine = {

	sidebar: {

		// Returns whether the sidebar can be appended safely
		isReadyToBeAppended: function() {
			var isReady = templatesReady && $(Gmail.selectors.sidebar).length;
			log.debug( 'LdEngine.sidebar.isReadyToBeAppended? ' + isReady );
			return isReady;
		},

		hide: function () {
			$("#ldengine").fadeOut();
		},
		show: function () {
			$("#ldengine").fadeIn();
		},


		init: function() {
			log.debug( 'LdEngine.sidebar.init()' );

			// Scrape email address to send to server to verify identity
			var emailString = $(".msg").text();
			emailString = emailString.match(/Loading (.+)…/i)[1];
			$(Gmail.selectors.sidebar).find(Gmail.selectors.userbar).remove();
			LDEngine.sidebar.appendLoadingSpinner();
			
			
			// Send request to server to see whether the user is logged in or not.
	//QUERY CODE
			// start timer that will fire if we do not get response back in time when checking the
			// account status.
			log.debug( 'Setting "no response" timer for 10 sec.' );
			var noResponse = setTimeout(function() {
					log.debug( '"no response" timer fired!' );
					LDEngine.sidebar.stopLoadingSpinner();
					LDEngine.sidebar.appendNoResponse();
				}, 10000);

			log.debug( 'Getting account status from: ' + API_URL + "/account/status for email string: " + emailString );
			$.get(API_URL + "/account/status", {
				email: emailString
			},function(data) {
				log.ifDebugEnabled( function() {
					log.debug( 'Account status returned: ' + JSON.stringify( data ));
				} );

				// if server has responded then we kill the functions waiting for the timer to end

				log.debug( 'Clearing no response timer.' );
				clearTimeout(noResponse);
				
				LDEngine.sidebar.accountStatus = data;
				// Render the appropriate UI depending if you have the data
				if (LDEngine.sidebar.accountStatus.status !== 'linked') {
					log.debug( 'Rendering Linked UI' );
					LDEngine.sidebar.append();
					$.link.unauthTemplate($('.lde-unauthenticated'), LDEngine.sidebar.accountStatus.AuthUrl);
					LDEngine.sidebar.stopLoadingSpinner();
				} else {
					log.debug( 'Rendering default UI' );
					LDEngine.sidebar.renderUI();
				}

			});
		},

		// set the height dynamically of the sidebar with JS. CSS will be used for the container with
		// overflow hidden for scrolling purposes
		setSidebarHeight: function(selector) {
			var sidebarHeight = $(window).height() - $('.nH.w-asV.aiw').outerHeight(true) -
													$('.aeH').height() - $('Bs.nH.iY').height();
			log.debug( 'Setting sidebar height to: ' + sidebarHeight );													
			$(selector).height(sidebarHeight);
		},

		renderUI: function() {
			log.debug( 'Starting to Render UI.' );
			
			// Draw empty sidebar
			this.append();

			
			// If your'e not logged in:
			// TODO: If you're logged in, do all this:
			// Draw loading spinner

			// Get the last message element
			$el = $(Gmail.selectors.message.container).last();
			// log.log("name div", $el.find('gD'), "email div", $el.find('go'));
			
			// Scrape the message from the Gmail UI
			Gmail.message.scrape($el, function(err, messageApiObj) {
			
			// Send the scrapped message to the server
					//hack	
					var currentUrl = document.location.href;
					var threadId;
		
					var threadArray = currentUrl.match(/\x23.*\x2f.*/i);
					var threadString = threadArray.join();
					threadString = threadString.split('\x2f');
					threadId = parseInt(threadString[1], 16);

			//		Gmail.scrapeMessageId(url, function( messageId) {
						
						messageApiObj.Message.thrid = threadId;
						
						Gmail.message.post(messageApiObj, function(messageSnippets, textStatus) { // afterwards

							// If no snippets are returned, render the noSnippets view and stop the ajax spinner.
							if (messageSnippets.length === 0) {
									$.link.noSnippetsTemplate('.lde-noSnippets');
									LDEngine.sidebar.stopLoadingSpinner();
									return;
							}
							_.map(messageSnippets, function(messageSnippet) {
								if( !messageSnippet.from.name )
									messageSnippet.from.name = messageSnippet.from.email;
								return _.extend(messageSnippet, {
									date: messageSnippet.date && new Date(messageSnippet.date).toString('MMM d yy'),
									from: _.extend(messageSnippet.from, {
										name: messageSnippet.from.name
									})
								});
							});
							
							
							// dont show the ajax spinner anymore
							log.debug( 'Stop the loading spinner.' );
							LDEngine.sidebar.stopLoadingSpinner();

							// render the sender info
							log.debug( 'Render senderInfo' );
							LDEngine.sidebar.senderInfo.render();
						
							// Render the message snippets returned from the server
							log.debug( 'Render message snippets' );
							LDEngine.sidebar.renderSnippets(messageSnippets);
						
							// Bind click events to search bar and some handling to prevent enter key bad behavior
							$('.lde-mag-glass').click(function() {
								LDEngine.sidebar.senderInfo.searchRequest(document.getElementById('search_field').field.value);	
							});
							//bad behavior stopper for enter key
							$('.lde-search-box').keypress(function(e){ 
								if ( e.which == 13 ) e.preventDefault();
							});
							//new behaviors added
							$('.lde-search-box').keyup(function(event) {
								if (event.keyCode == 13) {
									$('.lde-mag-glass').click();
								}
							});

							// fixed to prevent Google from capturing out scroll event
							$('.lde-related-emails').bind('mousewheel', function(e, delta) {
								e.stopPropagation();
								e.stopImmediatePropagation();
							});

				//		});			
				//	});
				});
			});
			

			// Listen for clicks on all messages
			Gmail.message.bindClick();

			log.debug( 'Done Rendering UI.' );

		},

		// Append sidebar to appropriate place in DOM
		append: function() {

			log.debug( 'LDEngine.sidebar.append()' );

			// Kill the container if it exists
			if($('#ldengine').length) {
				log.debug("SIDEBAR ALREADY EXISTS, detaching...");
				$('#ldengine').remove();
			}
			// Kill subcontainer if it exists
			if($(".lde-related-emails").length) {
				log.debug("lde-related-emails already exist, detaching...");
				$(".lde-related-emails").remove();
			}
			else {
				log.debug("lDE emails don't already exist. after all.");
			}

			// Stop watching for missing content
			LDEngine.watchTimer = LDEngine.watchTimer && window.clearInterval(LDEngine.watchTimer);

			// Start watching for missing content
			LDEngine.watchTimer = window.setInterval(LDEngine.sidebar.reattachIfNecessary,100);

			// Create the container
			var container = $('#ldengine');
			if (!container.length) container = $('<div id="ldengine"></div>');

			LDEngine.sidebar.setSidebarHeight('#ldengine');
			$('.adC').prepend(container);

			// No data, just a cheap way to render the html template
			$.link.ldengineTemplate('#ldengine');
		},

		// Append loading spinner to sidebar, right now the process of checking login
		// is taking the longest in the beginning.
		appendLoadingSpinner: function() {
			log.debug( 'LDEngine.sidebar.appendLoadingSpinner()' );

			$('td.Bu.y3').css({
				'position': 'relative'
			});
			$('.Bu.y3').append('<div class="lde-ajax-spinner"></div>');
			$('.lde-ajax-spinner').show();
		},

		// stop the loading spinner from being displayed,
		// We have this in its own method so it can be called anywhere we need it and dont
		// need to check conditions in appendLoadingSpinner.
		stopLoadingSpinner: function() {
			log.debug( 'LDEngine.sidebar.stopLoadingSpinner()' );
			$('.lde-ajax-spinner').hide();
		},

		appendNoResponse: function() {
			log.debug( 'LDEngine.sidebar.appendNoResponse()' );
			$('.Bu.y3').append('<div class="lde-no-response">Sorry, there was no response. Refresh to try again.</div>');
		},

		renderSnippets: function(messageSnippets) {
			log.debug( 'LDEngine.sidebar.renderSnippets()' );

			// Remove any Gmail stuff that's popped up
			$(Gmail.selectors.sidebar).find(Gmail.selectors.userbar).remove();

			// Add the related emails to the sidebar
			$.link.sidebarTemplate(".lde-related-emails", messageSnippets);

			if (!$('.lde-related-emails').length) {
				LDEngine.sidebar.append();
			}

			// Ellipsize the related email snippets
			$('.lde-email-result').dotdotdot();

			// Bind click events to message snippets
			for(var i = 0; i < messageSnippets.length; i++) {
				var messageSnippet = $($('.lde-email-result')[i]);
				messageSnippet.attr('data-id', messageSnippets[i].id);
				messageSnippet.click(LDEngine.sidebar.selectSnippet);

				
				// Replace \n's with <br>'s
				var snippetContentEl = messageSnippet.find(".lde-text");
				snippetContentEl.html(snippetContentEl.html().replace(/(\n)/g,"<br>"));
			}
		},

		//  Clicking on the snippet calls fetch
		selectSnippet: function(e) {
			log.debug( 'LDEngine.sidebar.selectSnippet()' );

			var id = $(e.currentTarget).attr('data-id');

			// Fetch contents of popup
			LDEngine.popup.fetch(id);
		},

		// Cancel the fetch
		cancelSelectSnippet: function(e) {

			var id = $(e.currentTarget).attr('data-id');

			// Cancel pending xhr
			if(LDEngine.popup.xhr) {
				LDEngine.popup.xhr.abort();
			}
			LDEngine.popup.close();
		},

		senderInfo: {

			// Render the sender info.
			render: function() {
				log.debug( 'LDEngine.sidebar.senderInfo.render()' );

				var senderInfo = {
					user: {
						name: LDEngine.sidebar.accountStatus && LDEngine.sidebar.accountStatus.user && LDEngine.sidebar.accountStatus.user.name,
						email: LDEngine.sidebar.accountStatus && LDEngine.sidebar.accountStatus.user && LDEngine.sidebar.accountStatus.user.email
					}
				};
				$.link.senderInfoTemplate('.lde-senderInfo', senderInfo);
			},
		searchRequest: function(query) {
			
			$.get(API_URL + "/message/search?query=" + query, {
			
			},function(searchSnippets) {
					if (searchSnippets.length === 0) {
							messageNull = { 
								from : { name : null }, 
								snippet : "Nothing related was found, try again?" };
							LDEngine.sidebar.renderSnippets(messageNull);
							return;
					};
					
					//Perform operations on Snippets
					_.map(searchSnippets, function(searchSnippet) {
							if( !searchSnippet.from.name )
							searchSnippet.from.name = searchSnippet.from.email;
							else 
						    {}	
						return _.extend(searchSnippet, {
							date: searchSnippet.date && new Date(searchSnippet.date).toString('MMM d yy'),
							from: _.extend(searchSnippet.from, {
								name: searchSnippet.from.name
							})
						});
					});


					// Render the message snippets returned from the server
					log.debug( 'Render message snippets' );
					LDEngine.sidebar.renderSnippets(searchSnippets);
					});

				}
		}

	},



	/**
	 * The popup
	 */
	popup: {

		// Gets the message details from the server
		fetch: function(id) {
			log.debug( 'LDEngine.sidebar.popup.fetch()' );
			// Display empty popup, clear model, and abort pending xhr request if necessary
			LDEngine.popup.model = null; 
			LDEngine.popup.display();
			if(LDEngine.popup.xhr) {
				LDEngine.popup.xhr.abort();
			}

			// Get the message details from the server
			LDEngine.popup.xhr = $.get(API_URL + '/message', {
				id: id,
				itemtype: 'message'
			}, function(model) {
				// will extend model to have its date property become a formated date
				_.extend(model, 
								{
									date: (function() {
												if( model.date ) {
													var moment_stringA, moment_stringB;
													moment_stringA = moment(model.date).startOf('day').fromNow();
													moment_stringB = moment(model.date).format("MMM Do YY");
												}
												return moment_stringB + ' (' + moment_stringA + ')';
											}()),
									msg_url: (function() {
												var gmail_url = (document.location.href).match(/.*#/gi);
												gmail_url += 'inbox/' + model.msgid;
				var html_string = '<a href="" target="_blank" onclick="window.open(\'' + gmail_url + '\')">Show Original</a>';
												return html_string;
											}()),
									//JsRender doesnt allow for much array manipulation, so we'll have to pass it things explicitly
									first_recipient: model.recipients[0],
									restof_recipients: (function() {
															var recipient_string = '', nameOf, emailOf;
															model.recipients.splice(0,1);
															for(var i = 0; i < model.recipients.length; i++ ) {
																nameOf = model.recipients[i].name;
																emailOf = model.recipients[i].email;
																recipient_string += nameOf + ' ' +  emailOf + '&#13;&#10;';
															}
															return recipient_string;
											}())
								}
						);
				LDEngine.popup.model = model;
				LDEngine.popup.display();
			});
		},

		// Display the popup
		display: function() {
			log.debug( 'LDEngine.sidebar.popup.display()' );
			// Draw the veil.
			LDEngine.popup.maskMessageArea(true);
			
			// Render the popup content
			if(!LDEngine.popup.model) {
				// Attach the popup container if necessary
				if(! $('#lde-popup').length) {
					var popupEl = $('<div id="lde-popup"></div>');
					$('.adC').parent().append(popupEl);
				}

				// Show the loading spinner and hide inner content
				// This code is really problematic so dont uncomment it

				/*$.link.popupTemplate($('#lde-popup'), {
					model: { 
							from: { name: "loading popup..." }
						}
				});
				$('.lde-popup-content').hide();*/

			} else {
				// Retemplate
				$.link.popupTemplate($('#lde-popup'), LDEngine.popup.model);
				// Hide the loading spinner and display inner content
				$('.lde-ajax-spinner').hide();
				$('.lde-popup-content').show();
			}

			// Hook up the close button
			$('.lde-popup-close-button').click(LDEngine.popup.close);
		},

		// Close the popup and hide the veil
		close: function() {
			log.debug( 'LDEngine.sidebar.popup.close()' );

			$('#lde-popup').detach();

			// Kill the mask.
			LDEngine.popup.maskMessageArea(false);
			
		},

		maskMessageArea: function(mask) {
			log.debug( 'LDEngine.sidebar.popup.maskMessageArea( ' + JSON.stringify( mask ) + ' )' );

			$('#lde-msg-mask').detach();
			// If we just want to remove the mask, we're done
			if(mask === false) {
				return;
			}
			// Otherwise, create a mask and place it over the message area
			else {
				var maskEl = $('<div id="lde-msg-mask"></div>').click(LDEngine.popup.close);
				$('.Bu').first().css('position', 'relative').append(maskEl);
			}
		}
	}
};

// Bind objects so we can use *this*
_.bindAll(LDEngine.sidebar);

// Watch for resize events and hide or show the sidebar accordingly
$(function () {
	$(window).bind('resize',_.throttle(function () {
		if ($(window).width() < 1140) LDEngine.sidebar.hide(150);
		else LDEngine.sidebar.show(250);
	},25));
});

