/*global window */
'use strict';

var WebDriver = require('selenium-webdriver');

module.exports = function(grunt) {
	/**
	 * Keep injecting scripts until window.mochaResults is set
	 */
	function collectTestResults(driver) {
		// inject a script that waits half a second
		return driver
			.executeAsyncScript(function() {
				var callback = arguments[arguments.length - 1];
				setTimeout(function() {
					// return the mocha results (or undefined if not finished)
					callback(window.mochaResults);
				}, 500);
			})
			.then(function(result) {
				// If there are no results, listen a little longer
				if (!result) {
					return collectTestResults(driver);

					// if there are, return them
				} else {
					return Promise.resolve(result);
				}
			});
	}

	/**
	 * Test each URL
	 */
	function runTestUrls(driver, isMobile, urls, errors) {
		var url = urls.shift();
		errors = errors || [];

		return (
			driver
				.get(url)
				// Get results
				.then(function() {
					return Promise.all([
						driver.getCapabilities(),
						collectTestResults(driver)
					]);
				})
				// And process them
				.then(function([capabilities, result]) {
					let browserName =
						capabilities.get('browserName') +
						(capabilities.get('mobileEmulationEnabled') ? '-mobile' : '');
					grunt.log.writeln(url + ' [' + browserName + ']');

					// Remember the errors
					(result.reports || []).forEach(function(err) {
						grunt.log.error(err.message);
						err.url = url;
						err.browser = browserName;
						errors.push(err);
					});

					// Log the result of the page tests
					grunt.log[result.failures ? 'error' : 'ok'](
						'passes: ' +
							result.passes +
							', ' +
							'failures: ' +
							result.failures +
							', ' +
							'duration: ' +
							result.duration / 1000 +
							's'
					);
					grunt.log.writeln();
				})
				.then(function() {
					// Start the next job, if any
					if (urls.length > 0) {
						return runTestUrls(driver, isMobile, urls, errors);
					} else {
						driver.quit();
						return Promise.resolve(errors);
					}
				})
		);
	}

	/*
	 * Build web driver depends whether REMOTE_SELENIUM_URL is set
	 */
	async function buildWebDriver(browser) {
		var capabilities;
		var mobileBrowser = browser.split('-mobile');
		if (mobileBrowser.length > 1) {
			browser = mobileBrowser[0];
			capabilities = {
				browserName: mobileBrowser[0],
				chromeOptions: {
					mobileEmulation: {
						deviceMetrics: {
							width: 320,
							height: 568,
							pixelRatio: 2
						}
					}
				}
			};
		}

		if (browser === 'ie') {
			browser = 'internet explorer';
		}

		var webdriver = new WebDriver.Builder()
			.withCapabilities(capabilities)
			.forBrowser(browser);

		if (process.env.REMOTE_SELENIUM_URL) {
			webdriver.usingServer(process.env.REMOTE_SELENIUM_URL);
		}

		return {
			driver: webdriver.build(),
			isMobile: mobileBrowser.length > 1
		};
	}

	/**
	 * Run all tests in a browser using webdriver
	 */
	grunt.registerMultiTask(
		'test-webdriver',
		'Task for launching Webdriver with options and running tests against options URLs',
		async function() {
			var driver;
			var isMobile = false;
			var done = this.async();
			var options = this.options({
				browser: 'firefox'
			});
			// yes, really, and this isn't documented anywhere either.
			options.browser =
				options.browser === 'edge' ? 'MicrosoftEdge' : options.browser;

			if (
				(process.platform === 'win32' && options.browser === 'safari') ||
				(process.platform === 'darwin' &&
					['internet explorer', 'MicrosoftEdge'].indexOf(options.browser) !==
						-1) ||
				((process.platform === 'linux' || process.env.REMOTE_SELENIUM_URL) &&
					['internet explorer', 'MicrosoftEdge', 'safari'].indexOf(
						options.browser
					) !== -1)
			) {
				grunt.log.writeln();
				grunt.log.writeln(
					'Skipped ' +
						options.browser +
						' as it is not supported on this platform'
				);
				return done();
			}

			// try to load the browser
			try {
				var webDriver = await buildWebDriver(options.browser);
				driver = webDriver.driver;
				isMobile = webDriver.isMobile;
				// If load fails, warn user and move to the next task
			} catch (err) {
				grunt.log.writeln();
				grunt.log.error(err.message);
				grunt.log.writeln('Aborted testing using ' + options.browser);
				return done();
			}

			// Give driver timeout options for scripts
			driver;

			// Test all pages
			runTestUrls(driver, isMobile, options.urls)
				.then(function(testErrors) {
					// log each error and abort
					testErrors.forEach(function(err) {
						grunt.log.writeln();
						grunt.log.error('URL: ' + err.url);
						grunt.log.error('Browser: ' + err.browser);
						grunt.log.error('Describe: ' + err.titles.join(' > '));
						grunt.log.error('it ' + err.name);
						grunt.log.error(err.stack);
						grunt.log.writeln();
					});

					// Return the success to Grunt
					done(testErrors.length === 0);

					// catch any potential problems
				})
				.catch(function(err) {
					grunt.log.error(err);
					done(false);
				});
		}
	);
};
