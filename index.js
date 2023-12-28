const { CallClient, VideoStreamRenderer, LocalVideoStream, LocalAudioStream, Features } = require('@azure/communication-calling');
const { AzureCommunicationTokenCredential} = require('@azure/communication-common');
const { AzureLogger, setLogLevel } = require("@azure/logger");
const { CommunicationIdentityClient } = require('@azure/communication-identity');
const { AzureKeyCredential } = require('@azure/core-auth');
const { AudioConfig, ResultReason, SpeechTranslationConfig, TranslationRecognizer } = require('microsoft-cognitiveservices-speech-sdk');

// Set the log level and output
setLogLevel('verbose');
AzureLogger.log = (...args) => {
};

// Calling web sdk objects
let callAgent;
let deviceManager;
let call;
let incomingCall;
let localVideoStream;
let localVideoStreamRenderer;

//Speech To Text
let speechConfig;
let audioConfig;
let speechRecognizer;
let translationRecognizer;
let SPEECH_KEY  = "0dcdbc6300114f14a36385030d6fc397";
let SPEECH_REGION = "southeastasia";


// UI widgets
let userAccessToken;
let calleeAcsUserId = document.getElementById('callee-acs-user-id');
let startCallButton = document.getElementById('start-call-button');
let hangUpCallButton = document.getElementById('hangup-call-button');
let acceptCallButton = document.getElementById('accept-call-button');
let startVideoButton = document.getElementById('start-video-button');
let stopVideoButton = document.getElementById('stop-video-button');
let connectedLabel = document.getElementById('connectedLabel');
let remoteVideosGallery = document.getElementById('remoteVideosGallery');
let localVideoContainer = document.getElementById('localVideoContainer');
let calleeIdentityText=document.getElementById('callee-identity-id');
let translatedCaption = document.getElementById('translatedCaption');

let muteButton = document.getElementById('mute-button');
let unmuteButton = document.getElementById('unmute-button');


//Timer to keep track of call duration.
let minutes = 0;
let seconds = 0;
let timerInterval;

//Subtitle info to pass into backend
let textObjInfo = []

//set access token and identity id
const main = async() =>{
    const endpoint = "https://recordvideosgab.asiapacific.communication.azure.com/"
    const accessKey = "LXiwlGYsuY8uRn91TJwKsG1OYmb05bOHmBnYGnktGlexzG+x0n3YJjF13Mk8+oLGTmLCgv6Gop4oXeTmmA/aUg=="
    const tokenCredential = new AzureKeyCredential(accessKey);
    // Instantiate the identity client
    const identityClient = new CommunicationIdentityClient(endpoint, tokenCredential);

    // Authenticate with managed identity
    // const endpoint = "https://ifast-chat-communication-service.asiapacific.communication.azure.com/";
    // const tokenCredential = new DefaultAzureCredential();
    // const identityClient = new CommunicationIdentityClient(endpoint, tokenCredential);

    // Create an identity
    let identityResponse = await identityClient.createUser();
    calleeIdentityText.textContent=identityResponse.communicationUserId;
    // Issue an access token with a validity of 24 hours and the "voip" scope for an identity
    let tokenResponse = await identityClient.getToken(identityResponse, ["voip"]);
    let { token, expiresOn } = tokenResponse;

    userAccessToken=token;

    initializeCallAgent();
}


//Start the timer
function startTimer() {
    minutes = 0;
    seconds = 0;
    timerInterval = setInterval(() => {
        seconds++;
        if (seconds === 60) {
            minutes++;
            seconds = 0;
        }
    }, 1000); // Update the timer every second (1000 milliseconds)
}


//Stop the timer
function stopTimer() {
    clearInterval(timerInterval);
    // You can use the 'minutes' and 'seconds' variables to get the recorded time
    console.log(`Call duration: ${minutes} minutes ${seconds} seconds`);
}




function initializeSpeechToText(mediaStream) {

    let speechTranslationConfig = SpeechTranslationConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
    speechTranslationConfig.speechRecognitionLanguage = "en-US";
    speechTranslationConfig.addTargetLanguage("zh-CN");

    let audioConfig = AudioConfig.fromStreamInput(mediaStream);
    translationRecognizer = new TranslationRecognizer(speechTranslationConfig, audioConfig);

    // Create an audio context
    let audioContext = new AudioContext();
    //Create an audioSource from the mediaStream
    let audioSource = audioContext.createMediaStreamSource(mediaStream);
    //Initialise analyser for accessing the frequency data.
    let analyser = audioContext.createAnalyser();
    //Connect analyser to keep track of the state of audioSource
    audioSource.connect(analyser);


    // Adjust this threshold value as needed,(maybe need to be dynamic)
    const THRESHOLD = 30;

    translationRecognizer.recognized = (s, e) => {
        // Get audio data and check if it surpasses the threshold

        //https://stackoverflow.com/questions/72624598/is-there-any-way-to-track-volume-with-the-web-audio-api (References from here)
        let bufferLength = analyser.frequencyBinCount;
        let dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for(const amplitude of dataArray){
            sum+= amplitude * amplitude
        }

        const volumeLevel = Math.sqrt(sum / dataArray.length)

;
        console.log(bufferLength,'bufferLength')
        console.log(dataArray,'dataArray')
        console.log(volumeLevel,'volumeLevel');
        console.log(audioContext.getOutputTimestamp(),"timestamp")

        if (volumeLevel > THRESHOLD && volumeLevel != 0) {
            if (e.result.reason == ResultReason.TranslatedSpeech) {
                console.log(`TRANSLATED: Text=${e.result.translations.get("zh-Hans")}`);
                translatedCaption.innerHTML = "Translation: " + e.result.translations.get("zh-Hans");

                //store text
                let originalText = e.result.text;
                let translatedText = e.result.translations.get("zh-Hans");

                //Current audio time
                const currentTimer =  `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`

                // Create temp object to store data
                let translatedData = {
                    original: originalText,
                    translated: translatedText,
                    timestamp: currentTimer
                };
                textObjInfo.push(translatedData);
                console.log(textObjInfo,"stored subtitle info")
            } else if (e.result.reason == ResultReason.NoMatch) {
                console.log("NOMATCH: Speech could not be translated.");
                translatedCaption.innerHTML = "Translation: ";
            } else {
                console.log("got else prob");
            }
        } else {
            // Below threshold, do something else or ignore translation
            console.log("Volume level below threshold");
        }
    };

    translationRecognizer.startContinuousRecognitionAsync();

    //Check for quota(Uncomment this then run this part of code, see privtDetails properties in result data, whether got said "quota reached" or not)
    // translationRecognizer.recognizeOnceAsync(result => {
    //     console.log(result)
    //
    // });

}


initializeCallAgent = async() =>{
    try {
        const callClient = new CallClient(); 
        tokenCredential = new AzureCommunicationTokenCredential(userAccessToken.trim());
        callAgent = await callClient.createCallAgent(tokenCredential)
        // Set up a camera device to use.
        deviceManager = await callClient.getDeviceManager();
        await deviceManager.askDevicePermission({ video: true });
        await deviceManager.askDevicePermission({ audio: true });
        // Listen for an incoming call to accept.
        callAgent.on('incomingCall', async (args) => {
            try {
                incomingCall = args.incomingCall;
                acceptCallButton.disabled = false;
                startCallButton.disabled = true;
            } catch (error) {
                console.error(error);
            }
        });

        startCallButton.disabled = false;
    } catch(error) {
        console.error(error);
    }
}

unmuteButton.onclick = async() =>{
    await call.unmute();
}

muteButton.onclick = async() =>{
    await call.mute();
}

startCallButton.onclick = async () => {
    try {
        const localVideoStream = await createLocalVideoStream();
        const localAudioStream = await createLocalAudioStream();
        const videoOptions = localVideoStream ? { localVideoStreams: [localVideoStream]} : undefined;
        const audioOptions = localAudioStream ? {muted: false,localAudioStream: [localAudioStream]} : undefined;
        call = callAgent.startCall([{ communicationUserId: calleeAcsUserId.value.trim() }], { videoOptions, audioOptions });
        subscribeToCall(call);
    } catch (error) {
        console.error(error);
    }
}

/**
 * Accepting an incoming call with video
 * Add an event listener to accept a call when the `acceptCallButton` is clicked:
 * After subscribing to the `CallAgent.on('incomingCall')` event, you can accept the incoming call.
 * You can pass the local video stream which you want to use to accept the call with.
 */
acceptCallButton.onclick = async () => {
    try {
        const localVideoStream = await createLocalVideoStream();
        const localAudioStream = await createLocalAudioStream();
        const videoOptions = localVideoStream ? { localVideoStreams: [localVideoStream]} : undefined;
        const audioOptions = localAudioStream ? {muted: false,localAudioStream: [localAudioStream]} : undefined;
        call = await incomingCall.accept({ videoOptions, audioOptions});
        // Subscribe to the call's properties and events.
        subscribeToCall(call);
    } catch (error) {
        console.error(error);
    }
}

/**
 * Subscribe to a call obj.
 * Listen for property changes and collection updates.
 */
subscribeToCall = (call) => {
    try {
        // Inspect the initial call.id value.
        //Subscribe to call's 'idChanged' event for value changes.
        call.on('idChanged', () => {
        });

        // Inspect the initial call.state value.
        // Subscribe to call's 'stateChanged' event for value changes.
        call.on('stateChanged', async () => {
            if(call.state === 'Connected') {
                console.log(call);
                console.log(call._remoteAudioStreams);
                console.log(call.remoteAudioStreams);
                console.log('_remoteAudioStreams' in call);
                console.log('remoteAudioStreams' in call);
                console.log(call._remoteAudioStreams.length);
                console.log(call.remoteAudioStreams.length);
                console.log(call.info.getServerCallId(),"serverId");
                connectedLabel.hidden = false;
                acceptCallButton.disabled = true;
                startCallButton.disabled = true;
                hangUpCallButton.disabled = false;
                startVideoButton.disabled = false;
                stopVideoButton.disabled = false;
                remoteVideosGallery.hidden = false;

                // Start call timer
                startTimer()
            } else if (call.state === 'Disconnected') {
                connectedLabel.hidden = true;
                startCallButton.disabled = false;
                hangUpCallButton.disabled = true;
                startVideoButton.disabled = true;
                stopVideoButton.disabled = true;

                // The translation after the call is ended
                translationRecognizer.stopContinuousRecognitionAsync();

                //End call timer()
                stopTimer()
                console.log(textObjInfo,"finalObj added")

            }   
        });



        call.on('remoteAudioStreamsUpdated',(e)=>{
            console.log("audioo")
            console.log(e.added,"e added")
            //Indicate how many ppl(media count) is connected
            e.added.forEach(async(lvs)=>{
                console.log("yo");
                console.log(lvs);
                // console.log(lvs.getMediaStream());
                const mediaStream = await lvs.getMediaStream();
                initializeSpeechToText(mediaStream);
        })});


        call.on('isLocalVideoStartedChanged', () => {
        });
        call.localVideoStreams.forEach(async (lvs) => {
            localVideoStream = lvs;
            await displayLocalVideoStream();
        });
        call.on('localVideoStreamsUpdated', e => {
            e.added.forEach(async (lvs) => {
                localVideoStream = lvs;
                await displayLocalVideoStream();
            });
            e.removed.forEach(lvs => {
               removeLocalVideoStream();
            });
        });
        
        // Inspect the call's current remote participants and subscribe to them.
        call.remoteParticipants.forEach(remoteParticipant => {
            subscribeToRemoteParticipant(remoteParticipant);
        });
        // Subscribe to the call's 'remoteParticipantsUpdated' event to be
        // notified when new participants are added to the call or removed from the call.
        call.on('remoteParticipantsUpdated', e => {
            // Subscribe to new remote participants that are added to the call.
            e.added.forEach(remoteParticipant => {
                subscribeToRemoteParticipant(remoteParticipant)
            });
            // Unsubscribe from participants that are removed from the call
            e.removed.forEach(remoteParticipant => {
            });
        });
    } catch (error) {
        console.error(error);
    }
}

/**
 * Subscribe to a remote participant obj.
 * Listen for property changes and collection udpates.
 */
subscribeToRemoteParticipant = (remoteParticipant) => {
    try {
        // Inspect the initial remoteParticipant.state value.
        // Subscribe to remoteParticipant's 'stateChanged' event for value changes.
        remoteParticipant.on('stateChanged', () => {
        });

        // Inspect the remoteParticipants's current videoStreams and subscribe to them.
        remoteParticipant.videoStreams.forEach(remoteVideoStream => {
            subscribeToRemoteVideoStream(remoteVideoStream)
        });
        
        // Subscribe to the remoteParticipant's 'videoStreamsUpdated' event to be
        // notified when the remoteParticiapant adds new videoStreams and removes video streams.
        remoteParticipant.on('videoStreamsUpdated', e => {
            // Subscribe to new remote participant's video streams that were added.
            e.added.forEach(remoteVideoStream => {
                subscribeToRemoteVideoStream(remoteVideoStream)
            });
            // Unsubscribe from remote participant's video streams that were removed.
            e.removed.forEach(remoteVideoStream => {
            })
        });
    } catch (error) {
        console.error(error);
    }
}

/**
 * Subscribe to a remote participant's remote video stream obj.
 * You have to subscribe to the 'isAvailableChanged' event to render the remoteVideoStream. If the 'isAvailable' property
 * changes to 'true', a remote participant is sending a stream. Whenever availability of a remote stream changes
 * you can choose to destroy the whole 'Renderer', a specific 'RendererView' or keep them, but this will result in displaying blank video frame.
 */
subscribeToRemoteVideoStream = async (remoteVideoStream) => {


    let renderer = new VideoStreamRenderer(remoteVideoStream);

    let view;
    let remoteVideoContainer = document.createElement('div');
    remoteVideoContainer.className = 'remote-video-container';

    let loadingSpinner = document.createElement('div');
    loadingSpinner.className = 'loading-spinner';
    remoteVideoStream.on('isReceivingChanged', async() => {
        try {
            if (remoteVideoStream.isAvailable) {
                const isReceiving = remoteVideoStream.isReceiving;
                const isLoadingSpinnerActive = remoteVideoContainer.contains(loadingSpinner);
                if (!isReceiving && !isLoadingSpinnerActive) {
                    remoteVideoContainer.appendChild(loadingSpinner);
                } else if (isReceiving && isLoadingSpinnerActive) {
                    remoteVideoContainer.removeChild(loadingSpinner);
                }
                mediaStream = await remoteVideoStream.getMediaStream();

                // initializeSpeechToText(mediaStream);
            }
        } catch (e) {
            console.error(e);
        }
    });

    const createView = async () => {
        // Create a renderer view for the remote video stream.
        view = await renderer.createView();
        // Attach the renderer view to the UI.
        remoteVideoContainer.appendChild(view.target);
        remoteVideosGallery.appendChild(remoteVideoContainer);
    }

    // Remote participant has switched video on/off
    remoteVideoStream.on('isAvailableChanged', async () => {
        try {
            if (remoteVideoStream.isAvailable) {
                await createView();
            } else {
                view.dispose();
                remoteVideosGallery.removeChild(remoteVideoContainer);
            }
        } catch (e) {
            console.error(e);
        }
    });

    // Remote participant has video on initially.
    if (remoteVideoStream.isAvailable) {
        try {
            await createView();
        } catch (e) {
            console.error(e);
        }
    }
}

/**
 * Start your local video stream.
 * This will send your local video stream to remote participants so they can view it.
 */
startVideoButton.onclick = async () => {
    try {
        const localVideoStream = await createLocalVideoStream();
        await call.startVideo(localVideoStream);
    } catch (error) {
        console.error(error);
    }
}

/**
 * Stop your local video stream.
 * This will stop your local video stream from being sent to remote participants.
 */
stopVideoButton.onclick = async () => {
    try {
        await call.stopVideo(localVideoStream);
    } catch (error) {
        console.error(error);
    }
}

/**
 * To render a LocalVideoStream, you need to create a new instance of VideoStreamRenderer, and then
 * create a new VideoStreamRendererView instance using the asynchronous createView() method.
 * You may then attach view.target to any UI element. 
 */
createLocalVideoStream = async () => {
    const camera = (await deviceManager.getCameras())[0];
    if (camera) {
        return new LocalVideoStream(camera);
    } else {
        console.error(`No camera device found on the system`);
    }
}

createLocalAudioStream = async () => {
    const audio = (await deviceManager.getMicrophones())[0];
    if (audio) {
        return new LocalAudioStream(audio);
    } else {
        console.error(`No camera device found on the system`);
    }
}


/**
 * Display your local video stream preview in your UI
 */
displayLocalVideoStream = async () => {
    try {
        localVideoStreamRenderer = new VideoStreamRenderer(localVideoStream);
        const view = await localVideoStreamRenderer.createView();
        localVideoContainer.hidden = false;
        localVideoContainer.appendChild(view.target);
    } catch (error) {
        console.error(error);
    } 
}

/**
 * Remove your local video stream preview from your UI
 */
removeLocalVideoStream = async() => {
    try {
        localVideoStreamRenderer.dispose();
        localVideoContainer.hidden = true;
    } catch (error) {
        console.error(error);
    } 
}

/**
 * End current call
 */
hangUpCallButton.addEventListener("click", async () => {
    // end the current call
    await call.hangUp();


});

document.addEventListener('DOMContentLoaded', main);