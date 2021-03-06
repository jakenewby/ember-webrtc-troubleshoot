/* global WebrtcTroubleshooter */
import Ember from 'ember';
import layout from './template';

const {
  ERROR_CODES,
  TestSuite,
  AudioTest,
  VideoTest,
  ConnectivityTest,
  AdvancedCameraTest,
  ThroughputTest,
  VideoBandwidthTest,
  AudioBandwidthTest,
  SymmetricNatTest,
  PermissionsTest
} = WebrtcTroubleshooter;

export default Ember.Component.extend({
  layout,
  classNames: ['webrtc-troubleshooter'],

  checkingMicPermissions: true,
  checkingMicrophone: true,
  checkMicrophoneSuccess: false,
  noMicrophona: false,
  checkingCameraPermissions: true,
  noCamera: false,
  checkingCamera: true,
  checkCameraSuccess: false,
  checkingCameraAdvanced: true,
  checkCameraAdvancedSuccess: false,
  checkingSymmetricNat: true,
  checkingConnectivity: true,
  checkConnectivitySuccess: false,
  checkingThroughput: true,
  checkingThroughputSuccess: false,
  checkingBandwidth: true,
  checkBandwidthSuccess: false,
  showBandwidthStats: false,

  bandwidthMediaError: false,
  bandwidthIceError: false,

  saveSuiteToWindow: false,
  advancedCameraTestResults: [],

  video: true,
  audio: true,
  useLegacyPermissionCheck: false,
  logger: null,
  integrationTestMode: false,

  iceServers: null,

  advCameraResolutions: Ember.computed('advancedCameraTestResults', function () {
    const results = this.get('advancedCameraTestResults');
    if (!results.map) {
      return [];
    }

    return this.get('advancedCameraTestResults').map(testLog => {
      const success = testLog.status === 'passed';

      let testResolution;
      if (success) {
        testResolution = testLog.results.resolutions[0];
      } else {
        testResolution = testLog.details.resolutions[0];
      }

      const resolution = `${testResolution[0]}x${testResolution[1]}`;

      return { resolution, success };
    });
  }),

  init () {
    this._super(...arguments);
    if (!this.get('logger')) {
      this.set('logger', Ember.Logger);
    }
    this.startTroubleshooter();
  },

  safeSetProperties (obj) {
    Ember.run(() => {
      if (this.get('isDestroyed') || this.get('isDestroying')) {
        return;
      }
      this.setProperties(obj);
    });
  },

  connectivityPortAttempts: 0,
  connectivityMaxPortAttempts: 20,

  runConnectivityTest (iceConfig) {
    const connectivityTest = new ConnectivityTest(iceConfig);
    this.testSuite.addTest(connectivityTest);
    let xlowPort, lowPort, medPort, highPort;
    connectivityTest.promise.then(() => {
      const ports = [];
      connectivityTest.pc1._candidateBuffer.forEach(p => ports.push(p.port));
      connectivityTest.pc2._candidateBuffer.forEach(p => ports.push(p.port));
      ports.forEach(p => {
        const portNum = Number(p);
        if (portNum < 16384) {
          xlowPort = true;
        } else if (portNum < 32768) {
          lowPort = true;
        } else if (portNum < 49151) {
          medPort = true;
        } else {
          highPort = true;
        }
      });
      console.log('ports used', { ports, xlowPort, lowPort, medPort, highPort });
      if (!lowPort) {
        if (this.get('connectivityPortAttempts') < this.connectivityMaxPortAttempts) {
          this.incrementProperty('connectivityPortAttempts');
          return this.runConnectivityTest(iceConfig);
        }
        const err = new Error('Failed to find port in required range (16384-32768)');
        err.code = 'PORT_REQUIREMENT';
        return Promise.reject(err);
      }
      this.safeSetProperties({
        checkingConnectivity: false,
        checkConnectivitySuccess: true
      });
    }).catch((err) => {
      this.logger.error('connectivityTest failed', err.code);
      this.safeSetProperties({
        connectivityPortError: err.code === 'PORT_REQUIREMENT',
        checkingConnectivity: false,
        checkConnectivitySuccess: false
      });
    });
  },

  startTroubleshooter: function () {
    if (!navigator.mediaDevices) {
      this.set('video', false);
      this.set('audio', false);
    }
    const iceConfig = {
      iceServers: this.get('iceServers') || [],
      iceTransports: 'relay',
      logger: this.get('logger')
    };

    const mediaOptions = this.get('mediaOptions') || this.getProperties(['audio', 'video', 'logger']);

    const testSuite = new TestSuite({ logger: this.get('logger') });

    if (this.get('saveSuiteToWindow')) {
      window.testSuite = testSuite;
    }
    this.set('testSuite', testSuite);

    // TODO: logs for rejections?

    if (this.get('audio')) {
      if (!this.get('skipPermissionsCheck')) {
        const micPermissionTest = new PermissionsTest(false, this.useLegacyPermissionCheck, mediaOptions);
        micPermissionTest.promise
          .then(() => {
            this.safeSetProperties({
              checkingMicPermissions: false,
              micPermissionsSuccess: true
            });
          })
          .catch((err) => {
            this.logger.error('audioTest failed', err);
            this.safeSetProperties({
              checkingMicPermissions: false,
              micPermissionsSuccess: false,
              noMicrophone: err.message === 'noDevicePermissions'
            });
          });
        testSuite.addTest(micPermissionTest);
      }

      const audioTest = new AudioTest(mediaOptions);
      audioTest.promise.then((/* logs */) => {
        this.safeSetProperties({
          checkingMicrophone: false,
          checkMicrophoneSuccess: true,
          checkingVolume: false,
          checkVolumeSuccess: true
        });
      }, (err) => {
        this.logger.error('audioTest failed', err);
        const micIssue = err.message !== 'audio timeout';
        const volumeIssue = err.message === 'audio timeout';
        this.safeSetProperties({
          checkingMicrophone: false,
          checkMicrophoneSuccess: !micIssue,
          checkingVolume: false,
          checkVolumeSuccess: !volumeIssue
        });
      });

      testSuite.addTest(audioTest);
    }

    if (this.get('video')) {
      if (!this.get('skipPermissionsCheck')) {
        const cameraPermissionTest = new PermissionsTest(true, this.useLegacyPermissionCheck, mediaOptions);
        cameraPermissionTest.promise
          .then(() => {
            this.safeSetProperties({
              checkingCameraPermissions: false,
              cameraPermissionsSuccess: true
            });
          })
          .catch((err) => {
            this.logger.error('audioTest failed', err);
            this.safeSetProperties({
              checkingCameraPermissions: false,
              cameraPermissionsSuccess: false,
              noCamera: err.message === 'noDevicePermissions'
            });
          });
        testSuite.addTest(cameraPermissionTest);
      }

      const videoTest = new VideoTest(mediaOptions);
      videoTest.promise.then((/* logs */) => {
        this.safeSetProperties({
          checkingCamera: false,
          checkCameraSuccess: true
        });
      }, (err) => {
        this.logger.error('videoTest failed', err);
        this.safeSetProperties({
          checkingCamera: false,
          checkCameraSuccess: false
        });
      });

      const advancedCameraTest = new AdvancedCameraTest(mediaOptions);
      advancedCameraTest.promise.then((testResults) => {
        this.logger.info('success - logs: ', testResults);
        this.set('advancedCameraTestResults', testResults);

        this.safeSetProperties({
          checkingCameraAdvanced: false,
          checkCameraAdvancedSuccess: true
        });
      }, (err) => {
        this.logger.info('error - logs: ', err);
        this.set('advancedCameraTestResults', err.details);

        this.logger.error('advancedCameraTest failed', err);
        this.safeSetProperties({
          checkingCameraAdvanced: false,
          checkCameraAdvancedSuccess: false
        });
      });

      testSuite.addTest(videoTest);
      testSuite.addTest(advancedCameraTest);
    }

    if (window.RTCPeerConnection) {
      const symmetricNatTest = new SymmetricNatTest();
      symmetricNatTest.promise.then(res => {
        this.safeSetProperties({
          checkingSymmetricNat: false,
          symmetricNatResult: `webrtcTroubleshoot.${res}`
        });
      }, (err) => {
        this.logger.error('symmetricNatTest failed', err);
        this.safeSetProperties({
          checkingSymmetricNat: false,
          symmetricNatResult: 'webrtcTroubleshoot.nat.error'
        });
      });

      this.runConnectivityTest(iceConfig);

      const throughputTest = new ThroughputTest(iceConfig);
      throughputTest.promise.then((/* logs */) => {
        this.safeSetProperties({
          checkingThroughput: false,
          checkThroughputSuccess: true
        });
      }, (err) => {
        this.logger.error('throughputTest failed', err);
        this.safeSetProperties({
          checkingThroughput: false,
          checkThroughputSuccess: false
        });
      });

      testSuite.addTest(symmetricNatTest);
      testSuite.addTest(throughputTest);

      let bandwidthTest;

      if (this.get('runVideoBandwidthTest')) {
        bandwidthTest = new VideoBandwidthTest({ iceConfig, mediaOptions });
      } else if (this.get('runAudioBandwidthTest')) {
        bandwidthTest = new AudioBandwidthTest({ iceConfig, mediaOptions });
      }

      if (bandwidthTest) {
        bandwidthTest.promise.then(results => {
          this.safeSetProperties({
            bandwidthStats: results && results.stats,
            checkingBandwidth: false,
            checkBandwidthSuccess: true
          });
        }, (results) => {
          if (results.pcCode === ERROR_CODES.ICE) {
            this.set('bandwidthIceError', true);
          } else if (results.pcCode === ERROR_CODES.MEDIA) {
            this.set('bandwidthMediaError', true);
          } else {
            this.set('bandWidthTestError', results);
            this.logger.error('bandwidthTest failed', results);
          }

          this.safeSetProperties({
            bandwidthStats: results && results.stats,
            checkingBandwidth: false,
            checkBandwidthSuccess: false
          });
        });
        testSuite.addTest(bandwidthTest);
      }
    }

    navigator.mediaDevices.enumerateDevices()
      .then((devices) => {
        this.logger.log('media devices', devices);
        this.logger.log('mediaOptions', mediaOptions);
        if (!this.get('integrationTestMode')) {
          return testSuite.start();
        }
      })
      .then((results) => {
        if (this.isDestroyed || this.isDestroying) {
          return;
        }

        this.logger.info('WebRTC Troubleshooting results (success)', results);
        this.sendAction('results', results);
        if (this.done) {
          this.done(results);
        }
      }).catch((err) => {
        this.logger.warn('WebRTC Troubleshooting results (error)', err, err && err.details);
        this.sendAction('results', err);
        if (this.done) {
          this.done(err);
        }
      });
  },

  runVideoBandwidthTest: Ember.computed.or('video', 'mediaOptions.screenStream'),

  runAudioBandwidthTest: Ember.computed('audio', 'runVideoBandwidthTest', function () {
    return !this.get('runVideoBandwidthTest') && this.get('audio');
  }),

  runBandwidthTest: Ember.computed.or('runVideoBandwidthTest', 'runAudioBandwidthTest'),

  symmetricNatResultGood: Ember.computed('symmetricNatResult', function () {
    const result = this.get('symmetricNatResult');
    switch (result) {
      case 'webrtcTroubleshoot.nat.asymmetric':
        return true;
      default:
        return false;
    }
  }),

  willDestroyElement () {
    try {
      var testSuite = this.get('testSuite');
      if (testSuite && testSuite.running) {
        testSuite.stopAllTests();
      }
    } catch (e) { /* don't care - just want to destroy */ }
  },

  actions: {
    toggleBandwidthStats () {
      this.toggleProperty('showBandwidthStats');
    }
  }
});
