function Logger() {
}
Logger.prototype.isDebugEnabled = function() {
	return true;
}
Logger.prototype.debug = function( message ) {
	if( this.isDebugEnabled() )
	{
		var time = new Date();
		setTimeout( function() {
			console.log( '*** ldengine.js: ' + time.getTime() + ': ' + message );
		}, 0 );
	}
}
var log = new Logger();

// Bootstrap
$(function() {
	if( log.isDebugEnabled()) log.debug( 'Starting Bootstrap Function' );

	var checkForSidebarTimer = null;
	var checkForAdsTimer = null;
	var checkMessageLoadedTimer = null;
	var checkSidebarRetry;

	// When sidebar can we safely appended, immediately append it (spam until it's possible, then do it)
	throttledWaitUntil(LDEngine.sidebar.isReadyToBeAppended, LDEngine.sidebar.init, 25);

	// Start monitoring changes to browser history
	$(window).bind("popstate", function(event) {
		if( log.isDebugEnabled()) log.debug( 'Window popstate' );
		// On popstate, try to initialize the sidebar again
		if(window.location.hash.match(/#inbox\/\S+/)) {
			waitUntil(LDEngine.sidebar.isReadyToBeAppended, LDEngine.sidebar.init, 25);
		}
	});

	// Create a deferred object to wrap around a call to Chrome's
	// local storage API.  This lets us chain our request for
	// settings with our other startup requests

	function getSettings() {
		if( log.isDebugEnabled()) log.debug( 'getSettings()' );
		var getApiURLDeferredObj = $.Deferred();
		chrome.storage.local.get('ldengine_api_url', function(items) {

			// For now, to avoid any weird issues w/ people who already installed
			// the existing version, hard-code the production host
			// API_URL = "apps.ldengine.com";
			API_URL = items.ldengine_api_url || "https://apps.ldengine.com";
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
		// }, 'html'),e
		$.get(chrome.extension.getURL("progressbar.tmpl"), function(data) {
			$.templates('progressbarTemplate', data);
		}, 'html'),
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
	if( log.isDebugEnabled()) log.debug( 'Wait until: ' + test.toString() );
	var timer = setInterval(function() {
		typeof eachTime === "function" && eachTime();
		if(test()) {
			clearInterval(timer);
			sharedTimer && clearInterval(sharedTimer);
			if( log.isDebugEnabled()) {
				log.debug( 'Condition met: ' + test.toString() );
				log.debug( 'Performing action: ' + action.toString() );
			}
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
			if( log.isDebugEnabled()) log.debug( 'Scraping message data from DOM' );

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
						to: recipientEmails
						// TODO: cc, bcc
					}
				};
				if( log.isDebugEnabled()) log.debug( 'Message data scraped: ' + JSON.stringify( messageData ));
				callback(null, messageData );

			});
		},

		// Returns whether the *expanded* message is finished loading (and is therefore scrape-able)
		isReadyToScrape: function($el) {
			var ready = $el.find(Gmail.selectors.message.body).length;
			if( log.isDebugEnabled() ) log.debug( 'isReadyToScrape?: ' + ready );
			return ready;
		},

		// Triggered when a message container is clicked
		click: function($el) {
			var isThisMessageReadyToScrape = _.bind(Gmail.message.isReadyToScrape, this, $el);

			// TODO: call scrape()
			if( log.isDebugEnabled() ) {
				log.debug( 'Message Container Clicked, isThisMessageReadyToScrape?: ' + isThisMessageReadyToScrape );
				log.debug( 'TODO: "call scrape()"' );
			}
		},

		// Bind a click event to each message
		bindClick: function() {
			// $('.kv,.hn,.h7').bind('click', clickMessageThread);
		},

		// POST the message object to the server
		post: function(messageApiObj, callback) {

			// Post the message to the server and get related snippets
			if( log.isDebugEnabled() ) log.debug( 'Posting message back to ' + API_URL + "/message/relatedSnippets" );
			$.ajax(API_URL + "/message/relatedSnippets", {
				type: 'POST',
				data: messageApiObj,
				success: callback,
				dataType: 'json'
			});
		}
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
			if( log.isDebugEnabled() ) log.debug( 'LdEngine.sidebar.isReadyToBeAppended? ' + isReady );
			return isReady;
		},

		init: function() {
			if( log.isDebugEnabled() ) log.debug( 'LdEngine.sidebar.init()' );

			// Scrape email address to send to server to verify identity
			var emailString = $(".msg").text();
			emailString = emailString.match(/Loading (.+)…/i)[1];
			$(Gmail.selectors.sidebar).find(Gmail.selectors.userbar).remove();
			LDEngine.sidebar.appendLoadingSpinner();

			// Send request to server to see whether the user is logged in or not.

			// start timer that will fire if we do not get response back in time when checking the
			// account status.
			if( log.isDebugEnabled() ) log.debug( 'Setting "no response" timer for 10 sec.' );
			var noResponse = setTimeout(function() {
					if( log.isDebugEnabled() ) log.debug( '"no response" timer fired!' );
					LDEngine.sidebar.stopLoadingSpinner();
					LDEngine.sidebar.appendNoResponse();
				}, 10000);

			if( log.isDebugEnabled() ) log.debug( 'Getting account status from: ' + API_URL + "/account/status for email string: " + emailString );
			$.get(API_URL + "/account/status", {
				email: emailString
			},function(data) {
				if( log.isDebugEnabled() ) log.debug( 'Account status returned: ' + JSON.stringify( data ));

				// if server has responded then we kill the functions waiting for the timer to end

				if( log.isDebugEnabled() ) log.debug( 'Clearing no response timer.' );
				clearTimeout(noResponse);
				
				LDEngine.sidebar.accountStatus = data;

				// Render the appropriate UI depending if you have the data
				if (LDEngine.sidebar.accountStatus.status !== 'linked') {
					if( log.isDebugEnabled() ) log.debug( 'Rendering Linked UI' );
					LDEngine.sidebar.append();
					$.link.unauthTemplate($('.lde-unauthenticated'), LDEngine.sidebar.accountStatus.AuthUrl);
					LDEngine.sidebar.stopLoadingSpinner();
				} else {
					if( log.isDebugEnabled() ) log.debug( 'Rendering default UI' );
					LDEngine.sidebar.renderUI();
				}

			});
		},

		// set the height dynamically of the sidebar with JS. CSS will be used for the container with
		// overflow hidden for scrolling purposes
		setSidebarHeight: function(selector) {
			var sidebarHeight = $(window).height() - $('.nH.w-asV.aiw').outerHeight(true) -
													$('.aeH').height() - $('Bs.nH.iY').height();
			if( log.isDebugEnabled() ) log.debug( 'Setting sidebar height to: ' + sidebarHeight );													
			$(selector).height(sidebarHeight);
		},

		renderUI: function() {
			if( log.isDebugEnabled() ) log.debug( 'Starting to Render UI.' );

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
				Gmail.message.post(messageApiObj, function(messageSnippets, textStatus) { // afterwards

					// Marshal data from server

					// If no snippets are returned, render the noSnippets view and stop the ajax spinner.
					if (messageSnippets.length === 0) {
							$.link.noSnippetsTemplate('.lde-noSnippets');
							LDEngine.sidebar.stopLoadingSpinner();
							return;
					}

					_.map(messageSnippets, function(messageSnippet) {
						return _.extend(messageSnippet, {
							date: messageSnippet.date && new Date(messageSnippet.date).toString('MMM d'),
							from: _.extend(messageSnippet.from, {
								name: messageSnippet.from.name
							})
						});
					});

					// dont show the ajax spinner anymore
					if( log.isDebugEnabled() ) log.debug( 'Stop the loading spinner.' );
					LDEngine.sidebar.stopLoadingSpinner();

					// render the sender info
					if( log.isDebugEnabled() ) log.debug( 'Render senderInfo' );
					LDEngine.sidebar.senderInfo.render();

					// render the progressbar
					if( log.isDebugEnabled() ) log.debug( 'Render progress bar' );
					LDEngine.sidebar.progressBar.render();

					// Render the message snippets returned from the server
					if( log.isDebugEnabled() ) log.debug( 'Render message snippets' );
					LDEngine.sidebar.renderSnippets(messageSnippets);

					// fixed to prevent Google from capturing out scroll event
					$('.lde-related-emails').bind('mousewheel', function(e, delta) {
						e.stopPropagation();
						e.stopImmediatePropagation();
					});

				});
			});
			

			// Listen for clicks on all messages
			Gmail.message.bindClick();

			if( log.isDebugEnabled() ) log.debug( 'Done Rendering UI.' );

		},

		// Append sidebar to appropriate place in DOM
		append: function() {
			if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.append()' );

			// Kill the container if it exists
			if($('#ldengine').length) {
				$('#ldengine').detach();
			}
			// Create the container
			var block = $('<div id="ldengine"></div>');
			LDEngine.sidebar.setSidebarHeight('#ldengine');
			$('.adC').prepend(block);

			// No data, just a cheap way to render the html template
			$.link.ldengineTemplate('#ldengine');

		},

		// Append loading spinner to sidebar, right now the process of checking login
		// is taking the longest in the beginning.
		appendLoadingSpinner: function() {
			if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.appendLoadingSpinner()' );

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
			if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.stopLoadingSpinner()' );
			$('.lde-ajax-spinner').hide();
		},

		appendNoResponse: function() {
			if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.appendNoResponse()' );
			$('.Bu.y3').append('<div class="lde-no-response">Sorry, there was no response. Refresh to try again.</div>');
		},

		renderSnippets: function(messageSnippets) {
			if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.renderSnippets()' );

			// Remove any Gmail stuff that's popped up
			$(Gmail.selectors.sidebar).find(Gmail.selectors.userbar).remove();

			// Add the related emails to the sidebar
			$.link.sidebarTemplate(".lde-related-emails", messageSnippets);

			// Ellipsize the related email snippets
			$('.lde-email-result').dotdotdot();

			// Bind click events to message snippets
			for(var i = 0; i < messageSnippets.length; i++) {
				var messageSnippet = $($('.lde-email-result')[i]);
				messageSnippet.attr('data-id', messageSnippets[i].id);
				messageSnippet.click(LDEngine.sidebar.clickSnippet);

				
				// Replace \n's with <br>'s
				var snippetContentEl = messageSnippet.find(".lde-text");
				snippetContentEl.html(snippetContentEl.html().replace(/(\n)/g,"<br>"));
			}
		},

		//  Clicking on the snippet calls fetch
		clickSnippet: function(e) {
			if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.clickSnippet()' );

			var id = $(e.currentTarget).attr('data-id');

			// Fetch contents of popup
			LDEngine.popup.fetch(id);
		},

		progressBar: {

			// Renders the progress bar in to the sidebar and keeps it updated until the
			// entire inbox has been indexed.
			render: function() {
				if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.progressBar.render()' );

				var percentIndexed = LDEngine.sidebar.accountStatus.percentIndexed;

				// Dont even render if we already have everything indexed
				if (percentIndexed === 100) {
					if( log.isDebugEnabled() ) log.debug( '100% Indexed, hiding progress bar.' );
					LDEngine.sidebar.progressBar.hide();
					return;
				}

				// Place the progress bar
				$('.lde-progress-bar').html('');

				// updates UI based on new percentIndex every loop
				$.link.progressbarTemplate('.lde-progress-bar');
				if( log.isDebugEnabled() ) log.debug( 'Setting progress bar % to ' + percentIndexed );
				$('.lde-progress-status').css({
					width: percentIndexed + '%'
				});
				$('.lde-progress-value').html(percentIndexed + '%');
			},

			hide: function() {
				if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.progressBar.hide()' );
				$('.lde-progress-bar').fadeOut(2500, 'linear');
			}
		},

		senderInfo: {

			// Render the sender info.
			render: function() {
				if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.senderInfo.render()' );

				var senderInfo = {
					user: {
						name: LDEngine.sidebar.accountStatus && LDEngine.sidebar.accountStatus.user && LDEngine.sidebar.accountStatus.user.name,
						email: LDEngine.sidebar.accountStatus && LDEngine.sidebar.accountStatus.user && LDEngine.sidebar.accountStatus.user.email
					}
				};

				$.link.senderInfoTemplate('.lde-senderInfo', senderInfo);
			}
		}

	},



	/**
	 * The popup
	 */
	popup: {

		// Gets the message details from the server
		fetch: function(id) {
			if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.popup.fetch()' );

			// Display empty popup, clear model, and abort pending xhr request if necessary
			LDEngine.popup.model = null;
			LDEngine.popup.display();
			if(LDEngine.popup.xhr) {
				LDEngine.popup.xhr.abort();
			}

			// Get the message details from the server
			LDEngine.popup.xhr = $.get(API_URL + '/message', {
				id: id
			}, function(model) {

				// will extend model to have its date property become a formated date
				_.extend(model, {date: model.date && new Date(model.date).toString('MMM d')});

				LDEngine.popup.model = model;
				LDEngine.popup.display();
			});
		},

		// Display the popup
		display: function() {
			if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.popup.display()' );

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
				$.link.popupTemplate($('#lde-popup'), {
					from: {}
				});
				$('.lde-popup-content').hide();

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
			if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.popup.close()' );

			$('#lde-popup').detach();

			// Kill the mask.
			LDEngine.popup.maskMessageArea(false);
			
		},

		maskMessageArea: function(mask) {
			if( log.isDebugEnabled() ) log.debug( 'LDEngine.sidebar.popup.maskMessageArea( ' + JSON.stringify( mask ) + ' )' );

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
