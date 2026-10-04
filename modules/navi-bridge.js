/**
 * NaviBridge - CampusOS <-> Cactus Needle Agent Dispatcher
 * Copyright (c) 2026 KINGENIOUS. All Rights Reserved.
 * Proprietary software of KINGENIOUS (Ghana).
 * Bridges student natural language queries through the Cactus Needle
 * sidecar and routes clean intents directly into CampusOS data & map layer.
 */
(function(root) {
    const DEFAULT_SIDECAR_URL = 'http://127.0.0.1:8000';

    const NaviBridge = {
        sidecarUrl: DEFAULT_SIDECAR_URL,
        cloudUrl: '',
        isAvailable: false,
        isCloudAvailable: false,
        lastCheck: 0,
        recognition: null,
        isListening: false,

        getCloudUrl() {
            if (this.cloudUrl) return this.cloudUrl.replace(/\/+$/, '');
            if (typeof window !== 'undefined' && window.ENV && window.ENV.naviCloudUrl) {
                return window.ENV.naviCloudUrl.replace(/\/+$/, '');
            }
            // Auto-detect same-origin on live deployments (e.g. *.ustednav.app, *.vercel.app)
            if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.protocol.startsWith('http')) {
                const host = (window.location.hostname || '').toLowerCase();
                const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.endsWith('.local');
                if (!isLocal) {
                    if (host === 'ustednav.app') {
                        return 'https://www.ustednav.app';
                    }
                    return window.location.origin;
                }
            }
            return '';
        },

        getCloudEndpoint(path) {
            const base = this.getCloudUrl();
            if (!base) return '';
            const cleanBase = base.replace(/\/+$/, '');
            const cleanPath = path.startsWith('/') ? path : '/' + path;
            if (cleanBase.endsWith('/api')) {
                return cleanBase + cleanPath.replace(/^\/api/, '');
            }
            if (cleanPath.startsWith('/api/')) {
                return cleanBase + cleanPath;
            }
            return cleanBase + '/api' + cleanPath;
        },

        /**
         * Initialize Speech Recognition (Chrome, Edge, Safari, Android)
         */
        initSpeech() {
            const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRec) {
                console.warn('[NaviBridge] Web Speech API not supported on this browser.');
                return false;
            }
            if (this.recognition) {
                const prev = this.recognition;
                this.recognition = null;
                prev.onerror = null;
                prev.onend = null;
                try { prev.abort(); } catch(e) {}
            }
            this.recognition = new SpeechRec();
            // Continuous false is standard for query recognition and avoids Windows socket drops
            this.recognition.continuous = false;
            this.recognition.interimResults = true;
            try {
                const navLang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
                this.recognition.lang = navLang;
            } catch(e) {
                this.recognition.lang = 'en-US';
            }
            this.recognition.maxAlternatives = 1;

            this.recognition.onstart = () => {
                this.isListening = true;
                this.updateVoiceUI(true, '', 'Listening...');

                // Live Assistant Modal updates
                const statusBadge = document.getElementById('naviAssistantStatus');
                if (statusBadge) statusBadge.textContent = 'Listening...';
                const wavesEl = document.getElementById('naviAudioWaves');
                if (wavesEl) wavesEl.classList.add('active');
                const micToggle = document.getElementById('naviAssistantMicToggle');
                if (micToggle) {
                    micToggle.innerHTML = '<i class="fas fa-stop"></i><span>Stop Listening</span>';
                    micToggle.classList.add('active');
                }

                // Safety Watchdog: 14s window so user has plenty of time to ask their question
                if (this.maxVoiceTimer) clearTimeout(this.maxVoiceTimer);
                this.maxVoiceTimer = setTimeout(() => {
                    if (this.isListening) {
                        const toSend = (this.lastSpokenText || '').trim();
                        this.lastSpokenText = '';
                        this.stopVoice();
                        if (toSend && toSend.length > 1) {
                            this.askNavi(toSend);
                        } else {
                            this.setAssistantState('confused', {
                                statusText: "Didn't catch that",
                                speechText: "I couldn't hear your voice. Tap the orb or type below to ask Navi."
                            });
                        }
                    }
                }, 14000);
            };

            this.recognition.onresult = (event) => {
                let fullFinal = '';
                let fullInterim = '';
                for (let i = 0; i < event.results.length; ++i) {
                    const item = event.results[i];
                    if (item && item[0]) {
                        if (item.isFinal) {
                            fullFinal += item[0].transcript + ' ';
                        } else {
                            fullInterim += item[0].transcript;
                        }
                    }
                }
                const spoken = (fullFinal + fullInterim).trim();
                if (!spoken) return;

                this.lastSpokenText = spoken;
                const assistantInput = document.getElementById('naviAssistantInput');
                if (assistantInput) assistantInput.value = spoken;

                // Real-time live transcript for Google-style assistant modal!
                const transcriptEl = document.getElementById('naviAssistantTranscript');
                if (transcriptEl) {
                    transcriptEl.textContent = `“${spoken}”`;
                }
                const statusBadge = document.getElementById('naviAssistantStatus');
                if (statusBadge) {
                    statusBadge.textContent = 'Listening...';
                }
                const wavesEl = document.getElementById('naviAudioWaves');
                if (wavesEl) wavesEl.classList.add('active');

                this.updateVoiceUI(true, spoken, 'Listening...');

                // Final sentence or silence pause: dispatch snappily after user pauses speaking
                if (this.silenceTimer) clearTimeout(this.silenceTimer);
                const isFinalChunk = event.results[event.results.length - 1]?.isFinal;
                const delay = isFinalChunk ? 350 : 700;
                this.silenceTimer = setTimeout(() => {
                    if (this.isListening && this.lastSpokenText) {
                        if (this.maxVoiceTimer) clearTimeout(this.maxVoiceTimer);
                        const toSend = this.lastSpokenText.trim();
                        this.lastSpokenText = '';
                        this.stopVoice();
                        this.askNavi(toSend);
                    }
                }, delay);
            };

            this.recognition.onerror = (event) => {
                const err = (event && event.error) || '';
                if (err === 'aborted') {
                    this.stopVoice();
                    return;
                }

                // If user already spoke words before error/timeout, send them!
                const toSend = (this.lastSpokenText || '').trim();
                if (toSend && toSend.length > 1) {
                    this.lastSpokenText = '';
                    this.stopVoice();
                    this.askNavi(toSend);
                    return;
                }

                const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
                if (err === 'network' || (isOffline && (err === 'no-speech' || err === 'network' || err === 'service-not-allowed'))) {
                    this.stopVoice();
                    this.setAssistantState('confused', {
                        statusText: "Voice Offline",
                        speechText: "Browser voice recognition needs an internet connection on this device. Type your query below — full campus search and directions work offline!"
                    });
                    const assistantInput = document.getElementById('naviAssistantInput');
                    if (assistantInput) {
                        assistantInput.focus();
                        assistantInput.placeholder = "Type destination (works offline)...";
                    }
                    return;
                }

                // Smooth retry on momentary initial silence
                if (err === 'no-speech') {
                    if (this.isListening && this.noSpeechRetries < 2) {
                        this.noSpeechRetries++;
                        try {
                            this.recognition?.stop();
                            setTimeout(() => {
                                if (this.isListening) {
                                    try { this.recognition?.start(); } catch(e) {}
                                }
                            }, 200);
                            return;
                        } catch(e) {}
                    }
                    this.stopVoice();
                    this.setAssistantState('confused', {
                        statusText: "Didn't catch that",
                        speechText: "I couldn't hear your voice. Tap the orb or type your destination below."
                    });
                    return;
                }

                if (err === 'not-allowed') {
                    this.stopVoice();
                    this.setAssistantState('confused', {
                        statusText: "Microphone Blocked",
                        speechText: "Please allow microphone access in your browser to speak with Navi."
                    });
                    return;
                }

                console.warn('[NaviBridge] Speech recognition note:', err);
                this.stopVoice();
                this.setAssistantState('idle');
            };

            this.recognition.onend = () => {
                const toSend = (this.lastSpokenText || '').trim();
                this.lastSpokenText = '';
                this.stopVoice();
                if (toSend && toSend.length > 1) {
                    this.askNavi(toSend);
                } else if (this.isListening) {
                    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
                    if (isOffline) {
                        this.setAssistantState('confused', {
                            statusText: "Voice Offline",
                            speechText: "Browser voice recognition requires internet on this device. Type your query below — full campus search and directions work offline!"
                        });
                        const assistantInput = document.getElementById('naviAssistantInput');
                        if (assistantInput) {
                            assistantInput.focus();
                            assistantInput.placeholder = "Type destination (works offline)...";
                        }
                    } else {
                        this.setAssistantState('confused', {
                            statusText: "Didn't catch that",
                            speechText: "I couldn't hear your voice. Tap the orb or type your query below."
                        });
                    }
                }
            };

            return true;
        },

        /**
         * High-accuracy Speech-To-Text using Groq Whisper Large V3 Turbo
         * Transcribes raw audio from browser microphone in ~180ms
         */
        async transcribeAudio(audioBlob) {
            if (!audioBlob || audioBlob.size < 400) return null;

            // 1. Direct Groq Whisper (if client has GROQ key)
            const apiKey = (typeof window !== 'undefined' && window.GROQ_API_KEY) || 
                           (typeof process !== 'undefined' && process.env && process.env.GROQ_API_KEY) || '';
            if (apiKey) {
                try {
                    const fd = new FormData();
                    fd.append('file', audioBlob, 'speech.webm');
                    fd.append('model', 'whisper-large-v3-turbo');
                    fd.append('language', 'en');
                    fd.append('prompt', 'USTED Kumasi campus, ROB Block, Dr. Kotor Asare, Atwima Hall, Opoku Ware II Hall, Library, CBT, NFB, NLB');

                    const ctrl = new AbortController();
                    const timeoutId = setTimeout(() => ctrl.abort(), 6500);
                    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${apiKey}` },
                        body: fd,
                        signal: ctrl.signal
                    });
                    clearTimeout(timeoutId);
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.text && data.text.trim()) {
                            return data.text.trim();
                        }
                    }
                } catch(err) {
                    console.warn('[NaviBridge] Direct Whisper note:', err);
                }
            }

            // 2. Cloud Navi Whisper API (/api/transcribe) on live deployment
            const cloudUrl = this.getCloudEndpoint('/transcribe');
            if (cloudUrl) {
                try {
                    const fd = new FormData();
                    fd.append('file', audioBlob, 'speech.webm');
                    const ctrl = new AbortController();
                    const timeoutId = setTimeout(() => ctrl.abort(), 8500);
                    const res = await fetch(cloudUrl, {
                        method: 'POST',
                        body: fd,
                        signal: ctrl.signal
                    });
                    clearTimeout(timeoutId);
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.text && data.text.trim()) {
                            return data.text.trim();
                        }
                    }
                } catch(err) {
                    console.warn('[NaviBridge] Cloud Whisper note:', err);
                }
            }

            return null;
        },

        async startVoice() {
            this.noSpeechRetries = 0;
            this.lastSpokenText = '';
            this.audioChunks = [];
            this.isListening = true;
            this.isProcessingSpeech = false;
            const isOnline = typeof navigator === 'undefined' || navigator.onLine;

            this.setAssistantState('listening', { 
                statusText: isOnline ? 'Listening...' : 'Listening (Offline)...', 
                query: '',
                speechText: ''
            });

            // 1. Initialize Speech Recognition early (essential for offline voice on mobile)
            this.initSpeech();
            if (this.recognition) {
                try {
                    this.recognition.start();
                } catch(e) {}
            }

            // 2. Acquire and keep active microphone hardware stream
            let stream = null;
            if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }
                    });
                    this.activeMicStream = stream;
                } catch (micErr) {
                    console.warn('[NaviBridge] getUserMedia permission note:', micErr);
                    this.isListening = false;
                    this.setAssistantState('confused', {
                        statusText: "Microphone Blocked",
                        speechText: "Please allow microphone access in your browser to speak with Navi."
                    });
                    return;
                }
            }

            // Update UI elements
            this.updateVoiceUI(true, '', isOnline ? 'Listening...' : 'Listening (Offline)...');
            const statusBadge = document.getElementById('naviAssistantStatus');
            if (statusBadge) statusBadge.textContent = isOnline ? 'Listening...' : 'Listening (Offline)...';
            const wavesEl = document.getElementById('naviAudioWaves');
            if (wavesEl) wavesEl.classList.add('active');
            const micToggle = document.getElementById('naviAssistantMicToggle');
            if (micToggle) {
                micToggle.innerHTML = '<i class="fas fa-stop"></i><span>Stop Listening</span>';
                micToggle.classList.add('active');
            }

            // 3. Start hardware MediaRecorder for cloud Whisper (when online)
            if (typeof MediaRecorder !== 'undefined' && stream) {
                try {
                    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 
                                    (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 
                                    (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''));
                    this.recordedMimeType = mimeType;
                    const options = mimeType ? { mimeType } : {};
                    this.mediaRecorder = new MediaRecorder(stream, options);
                    this.audioChunks = [];

                    this.mediaRecorder.ondataavailable = (e) => {
                        if (e.data && e.data.size > 0) {
                            this.audioChunks.push(e.data);
                        }
                    };

                    this.mediaRecorder.onstop = async () => {
                        if (this.isProcessingSpeech) return;
                        this.isProcessingSpeech = true;

                        const blob = new Blob(this.audioChunks, { type: this.recordedMimeType || 'audio/webm' });
                        this.audioChunks = [];

                        let spokenText = (this.lastSpokenText || '').trim();

                        // Transcribe with Whisper if speech was short or WebSpeech didn't catch it (and online)
                        const onlineNow = typeof navigator === 'undefined' || navigator.onLine;
                        if ((!spokenText || spokenText.length < 3) && onlineNow) {
                            this.setAssistantState('thinking', { statusText: 'Transcribing speech...' });
                            const whisperText = await this.transcribeAudio(blob);
                            if (whisperText && whisperText.trim()) {
                                spokenText = whisperText.trim();
                            }
                        }

                        this.isProcessingSpeech = false;
                        if (spokenText && spokenText.length > 1) {
                            const transcriptEl = document.getElementById('naviAssistantTranscript');
                            if (transcriptEl) transcriptEl.textContent = `“${spokenText}”`;
                            const assistantInput = document.getElementById('naviAssistantInput');
                            if (assistantInput) assistantInput.value = spokenText;
                            this.askNavi(spokenText);
                        } else {
                            if (!onlineNow) {
                                this.setAssistantState('confused', {
                                    statusText: "Voice Offline",
                                    speechText: "Browser voice recognition needs an internet connection on this device. Type your query below — full offline campus search & navigation work 100%!"
                                });
                                const assistantInput = document.getElementById('naviAssistantInput');
                                if (assistantInput) {
                                    assistantInput.focus();
                                    assistantInput.placeholder = "Type destination (works offline)...";
                                }
                            } else {
                                this.setAssistantState('confused', {
                                    statusText: "Didn't catch that",
                                    speechText: "I couldn't hear your voice clearly. Tap the orb or type your query below."
                                });
                            }
                        }
                    };

                    this.mediaRecorder.start(250);
                } catch(recErr) {
                    console.warn('[NaviBridge] MediaRecorder init note:', recErr);
                }
            }

            // 4. AudioContext VAD (Voice Activity Detection) & Dynamic Wave Animator
            try {
                const AudioCtx = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
                if (AudioCtx && stream) {
                    this.audioContext = new AudioCtx();
                    const source = this.audioContext.createMediaStreamSource(stream);
                    const analyser = this.audioContext.createAnalyser();
                    analyser.fftSize = 256;
                    analyser.smoothingTimeConstant = 0.3;
                    source.connect(analyser);
                    const dataArray = new Uint8Array(analyser.frequencyBinCount);

                    let speechDetected = false;
                    let silenceStart = null;
                    const startTime = Date.now();

                    const monitorAudio = () => {
                        if (!this.isListening) return;
                        analyser.getByteFrequencyData(dataArray);
                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                        const volume = sum / dataArray.length;

                        // Modulate wave visualizer directly from real microphone audio!
                        const waves = document.getElementById('naviAudioWaves');
                        if (waves) {
                            if (volume > 10) {
                                waves.classList.add('active');
                                waves.style.opacity = Math.min(1, 0.4 + (volume / 50));
                            } else {
                                waves.style.opacity = '0.35';
                            }
                        }

                        // Real-time Voice Activity Detection
                        if (volume > 15) {
                            speechDetected = true;
                            silenceStart = null;
                        } else if (speechDetected) {
                            if (!silenceStart) {
                                silenceStart = Date.now();
                            } else if (Date.now() - silenceStart > 1100) {
                                // 1.1s silence after user finished speaking -> auto-stop and transcribe!
                                this.stopVoice();
                                return;
                            }
                        } else if (Date.now() - startTime > 10000) {
                            // 10s initial silence timeout
                            this.stopVoice();
                            return;
                        }

                        this.vadFrame = requestAnimationFrame(monitorAudio);
                    };
                    this.vadFrame = requestAnimationFrame(monitorAudio);
                }
            } catch(e) {}

            // Safety watchdog: 14s window
            if (this.maxVoiceTimer) clearTimeout(this.maxVoiceTimer);
            this.maxVoiceTimer = setTimeout(() => {
                if (this.isListening) this.stopVoice();
            }, 14000);
        },

        stopVoice() {
            this.isListening = false;
            if (this.silenceTimer) clearTimeout(this.silenceTimer);
            if (this.maxVoiceTimer) clearTimeout(this.maxVoiceTimer);
            if (this.vadFrame && typeof cancelAnimationFrame !== 'undefined') {
                cancelAnimationFrame(this.vadFrame);
                this.vadFrame = null;
            }
            if (this.audioContext) {
                try { this.audioContext.close(); } catch(e) {}
                this.audioContext = null;
            }
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                try { this.mediaRecorder.stop(); } catch(e) {}
            }
            if (typeof document !== 'undefined') {
                const micToggle = document.getElementById('naviAssistantMicToggle');
                if (micToggle) {
                    micToggle.innerHTML = '<i class="fas fa-microphone"></i><span>Tap to Speak</span>';
                    micToggle.classList.remove('active');
                }
            }
            if (this.activeMicStream) {
                try {
                    this.activeMicStream.getTracks().forEach(t => t.stop());
                } catch(e) {}
                this.activeMicStream = null;
            }
            if (this.recognition) {
                const rec = this.recognition;
                this.recognition = null;
                rec.onerror = null;
                rec.onend = null;
                try { rec.abort(); } catch(e) {}
            }
        },

        closeAssistant() {
            this.stopVoice();
            if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                try { window.speechSynthesis.cancel(); } catch(e) {}
            }
            this.setAssistantState('idle');
        },

        toggleVoice() {
            if (this.isListening) {
                this.stopVoice();
            } else {
                this.startVoice();
            }
        },

        speak(text, onEnd) {
            if (typeof window !== 'undefined' && 'speechSynthesis' in window && text) {
                try {
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.rate = 1.05;
                    utterance.pitch = 1.0;
                    utterance.onstart = () => {
                        this.setOrbVisualState('speaking');
                    };
                    utterance.onend = () => {
                        this.setOrbVisualState(this.currentAssistantState || 'idle');
                        if (typeof onEnd === 'function') onEnd();
                    };
                    utterance.onerror = () => {
                        this.setOrbVisualState(this.currentAssistantState || 'idle');
                    };
                    window.speechSynthesis.speak(utterance);
                } catch(e) {}
            }
        },

        autoHideTimeout: null,

        autoHideVoiceUI(delayMs = 3800) {
            if (this.autoHideTimeout) clearTimeout(this.autoHideTimeout);
            this.autoHideTimeout = setTimeout(() => {
                // Only auto-hide if in idle or success state, not if user has suggestion chips to click
                if (this.currentAssistantState === 'success') {
                    this.closeAssistant();
                }
            }, delayMs);
        },

        calculateSimilarity(s1, s2) {
            if (!s1 || !s2) return 0;
            const a = s1.toLowerCase().trim();
            const b = s2.toLowerCase().trim();
            if (a === b) return 1.0;
            if (a.includes(b) || b.includes(a)) {
                return 0.85 + (Math.min(a.length, b.length) / Math.max(a.length, b.length)) * 0.14;
            }

            // Helper for Dice character bigram similarity between two single tokens
            const bigramDice = (x, y) => {
                const sX = x.replace(/[^a-z0-9]/g, '');
                const sY = y.replace(/[^a-z0-9]/g, '');
                if (!sX || !sY) return 0;
                if (sX === sY) return 1.0;
                const bgX = new Map();
                for (let i = 0; i < sX.length - 1; i++) {
                    const pair = sX.substr(i, 2);
                    bgX.set(pair, (bgX.get(pair) || 0) + 1);
                }
                let common = 0;
                for (let i = 0; i < sY.length - 1; i++) {
                    const pair = sY.substr(i, 2);
                    const count = bgX.get(pair) || 0;
                    if (count > 0) {
                        common++;
                        bgX.set(pair, count - 1);
                    }
                }
                const total = Math.max(0, sX.length - 1) + Math.max(0, sY.length - 1);
                return total > 0 ? (2 * common) / total : 0;
            };

            // Full string bigram dice
            const fullDice = bigramDice(a, b);

            const wordsA = a.split(/\s+/).filter(w => w.length > 1);
            const wordsB = b.split(/\s+/).filter(w => w.length > 1);
            if (wordsA.length === 0 || wordsB.length === 0) return fullDice;

            // Generic campus terms have lower discriminative weight
            const genericCampusTerms = new Set(['block', 'building', 'hall', 'room', 'dept', 'department', 'centre', 'center', 'the', 'of', 'and']);

            let weightedScoreSum = 0;
            let totalWeight = 0;

            for (const wa of wordsA) {
                const weight = genericCampusTerms.has(wa) ? 1.5 : Math.max(2, wa.length);
                totalWeight += weight;

                let bestWordMatch = 0;
                for (const wb of wordsB) {
                    const d = bigramDice(wa, wb);
                    if (d > bestWordMatch) bestWordMatch = d;
                }
                weightedScoreSum += bestWordMatch * weight;
            }

            const queryCoverage = totalWeight > 0 ? (weightedScoreSum / totalWeight) : 0;
            return Math.max(fullDice, queryCoverage);
        },

        getFuzzySuggestions(query, bData, pData, limit = 3) {
            if (!query) return [];
            const buildings = bData || (typeof window !== 'undefined' && window.CampusOS ? window.CampusOS.getBuildingsData() : []) || [];
            const people = pData || (typeof window !== 'undefined' && window.peopleData ? window.peopleData : []) || [];
            const scored = [];
            const seen = new Set();

            // Buildings & rooms
            buildings.forEach(b => {
                let maxBScore = this.calculateSimilarity(query, b.name || '');
                if (b.shortName) maxBScore = Math.max(maxBScore, this.calculateSimilarity(query, b.shortName));
                if (b.keywords && Array.isArray(b.keywords)) {
                    b.keywords.forEach(k => {
                        maxBScore = Math.max(maxBScore, this.calculateSimilarity(query, k));
                    });
                }
                if (maxBScore > 0.28 && !seen.has(b.name)) {
                    seen.add(b.name);
                    scored.push({
                        name: b.name,
                        type: 'building',
                        building: b,
                        score: maxBScore
                    });
                }
            });

            // Staff & departments
            people.forEach(p => {
                const pName = p.name || p.full_name || '';
                const pScore = this.calculateSimilarity(query, pName);
                if (pScore > 0.35 && !seen.has(pName)) {
                    seen.add(pName);
                    const bCode = (p.building || p.buildingName || p.buildingId || '').toLowerCase();
                    const bOffice = buildings.find(b => 
                        (b.id && String(b.id).toLowerCase() === bCode) ||
                        (b.shortName && b.shortName.toLowerCase() === bCode) ||
                        (b.name && b.name.toLowerCase().includes(bCode))
                    ) || null;
                    scored.push({
                        name: `${pName} (${p.department || 'Staff'})`,
                        type: 'staff',
                        building: bOffice,
                        score: pScore
                    });
                }
            });

            scored.sort((a, b) => b.score - a.score);
            return scored.slice(0, limit);
        },

        getDefaultLandmarks(bData) {
            const buildings = bData || (typeof window !== 'undefined' && window.CampusOS ? window.CampusOS.getBuildingsData() : []) || [];
            const defaults = ['Library', 'Auditorium', 'Mosque', 'Catering', 'Clinic', 'Management'];
            const matched = [];
            defaults.forEach(key => {
                const found = buildings.find(b => (b.name && b.name.toLowerCase().includes(key.toLowerCase())));
                if (found && !matched.some(m => m.name === found.name)) {
                    matched.push({
                        name: found.name,
                        type: 'building',
                        building: found,
                        score: 0.5
                    });
                }
            });
            return matched.slice(0, 3);
        },

        currentAssistantState: 'idle',

        setOrbVisualState(state) {
            if (typeof document === 'undefined') return;
            const heroOrb = document.getElementById('naviHeroOrb');
            const screenOrb = document.getElementById('naviOrbTrigger');
            if (heroOrb) {
                heroOrb.className = `navi-hero-orb state-${state}`;
            }
            if (screenOrb) {
                screenOrb.className = `navi-screen-orb state-${state}`;
            }
        },

        setAssistantState(state, data = {}) {
            this.currentAssistantState = state;
            if (typeof document === 'undefined') return;

            const overlay = document.getElementById('naviAssistantOverlay');
            const statusBadge = document.getElementById('naviAssistantStatus');
            const transcriptEl = document.getElementById('naviAssistantTranscript');
            const responseTextEl = document.getElementById('naviAssistantResponse');
            const suggestionsEl = document.getElementById('naviAssistantSuggestions');
            const wavesEl = document.getElementById('naviAudioWaves');

            this.setOrbVisualState(state);

            // Legacy HUD & Button compatibility
            this.updateVoiceUI(state !== 'idle', data.query || data.text || '', data.statusText || state);

            if (!overlay) return;

            if (state === 'idle') {
                overlay?.classList?.remove('active');
                if (wavesEl) wavesEl?.classList?.remove('active');
                return;
            }

            overlay?.classList?.add('active');

            if (wavesEl) {
                if (state === 'listening') wavesEl?.classList?.add('active');
                else wavesEl?.classList?.remove('active');
            }

            if (statusBadge) {
                const statusLabels = {
                    listening: 'Listening...',
                    thinking: 'Thinking...',
                    speaking: 'Navi AI',
                    success: 'Destination Found',
                    confused: 'Location Not Pinpointed'
                };
                statusBadge.textContent = data.statusText || statusLabels[state] || 'Navi AI';
            }

            if (transcriptEl) {
                if (data.query !== undefined) {
                    transcriptEl.textContent = data.query ? `“${data.query}”` : 'What can I help you find?';
                }
            }

            if (responseTextEl) {
                if (data.speechText || data.message) {
                    responseTextEl.textContent = data.speechText || data.message;
                    responseTextEl.style.display = 'block';
                } else if (state === 'listening' || state === 'thinking') {
                    responseTextEl.textContent = '';
                    responseTextEl.style.display = 'none';
                }
            }

            if (suggestionsEl) {
                suggestionsEl.innerHTML = '';
                if (data.suggestions && data.suggestions.length > 0) {
                    suggestionsEl.style.display = 'flex';
                    data.suggestions.forEach(item => {
                        const chip = document.createElement('button');
                        chip.className = 'navi-suggestion-chip';
                        chip.innerHTML = `<i class="fas fa-location-dot"></i><span>${item.name}</span>`;
                        chip.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.speak(`Routing to ${item.name}`);
                            this.setAssistantState('success', { 
                                query: item.name, 
                                speechText: `Routing to ${item.name}`,
                                statusText: 'Navigating'
                            });
                            this.autoHideVoiceUI(3000);
                            if (item.building) {
                                this.triggerCampusRoute(item.building.lat, item.building.lng, item.name);
                            } else {
                                this.fallbackSearch(item.name);
                            }
                        });
                        suggestionsEl.appendChild(chip);
                    });
                } else {
                    suggestionsEl.style.display = 'none';
                }
            }
        },

        updateVoiceUI(active, text = '', statusText = '') {
            if (typeof document === 'undefined') return;
            const btn = document.getElementById('searchVoiceBtn');
            const hud = document.getElementById('naviVoiceHud') || document.getElementById('charlieVoiceHud');
            const transcript = document.getElementById('naviTranscript') || document.getElementById('charlieTranscript');
            const status = document.getElementById('naviStatus') || document.getElementById('charlieStatus');

            if (btn) {
                if (active) btn?.classList?.add('listening');
                else btn?.classList?.remove('listening');
            }
            if (hud) {
                hud.style.display = 'none'; // Replaced by bottom Assistant sheet; do not display legacy HUD
            }
            if (transcript && text) {
                transcript.textContent = text;
            }
            if (status) {
                status.textContent = statusText || (active ? 'Listening...' : 'Ready');
            }
        },

        /**
         * Check Cloud Navi and local sidecar connectivity
         */
        async checkHealth() {
            const checks = [];

            // 1. Check Cloud Navi if online and URL configured
            const healthUrl = this.getCloudEndpoint('/health');
            if (healthUrl && (typeof navigator === 'undefined' || navigator.onLine)) {
                checks.push(
                    (async () => {
                        try {
                            const ctrl = new AbortController();
                            const timeoutId = setTimeout(() => ctrl.abort(), 4000);
                            const res = await fetch(healthUrl, { signal: ctrl.signal });
                            clearTimeout(timeoutId);
                            if (res.ok) {
                                const data = await res.json();
                                this.isCloudAvailable = true;
                                console.log('[NaviBridge] Cloud Navi connected:', data);
                                return true;
                            }
                        } catch (e) {
                            this.isCloudAvailable = false;
                        }
                        return false;
                    })()
                );
            }

            // 2. Check Local Sidecar ONLY if in a local dev environment (localhost/127.0.0.1/Node.js)
            // On production HTTPS deployments (e.g. ustednav.app), probing 127.0.0.1:8000
            // triggers net::ERR_CONNECTION_REFUSED and browser security errors.
            const isLocalEnv = typeof window === 'undefined' || 
                (window.location && (
                    window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' || 
                    window.location.hostname === '0.0.0.0' || 
                    window.location.hostname === '' ||
                    window.location.protocol === 'file:'
                ));

            if (isLocalEnv) {
                checks.push(
                    (async () => {
                        try {
                            const ctrl = new AbortController();
                            const timeoutId = setTimeout(() => ctrl.abort(), 600);
                            const res = await fetch(`${this.sidecarUrl}/health`, { signal: ctrl.signal });
                            clearTimeout(timeoutId);
                            if (res.ok) {
                                const data = await res.json();
                                this.isAvailable = true;
                                this.lastCheck = Date.now();
                                console.log('[NaviBridge] Local sidecar connected:', data);
                                return true;
                            }
                        } catch (e) {
                            this.isAvailable = false;
                            this.lastCheck = Date.now();
                        }
                        return false;
                    })()
                );
            }

            const results = await Promise.all(checks);
            return results.some(Boolean);
        },

        /**
         * Clean conversational prefixes and suffixes from query
         */
        cleanQuery(query) {
            if (!query) return '';
            let q = query.trim().replace(/[?!.,]+$/g, '').trim();
            const leadingPatterns = [
                /^(hey\s+navi|ok\s+navi|navi|hello|hi|please)\s+/i,
                /^(can\s+you\s+please|can\s+you|could\s+you|would\s+you)\s+/i,
                /^(i\s+want\s+to\s+go\s+to|i\s+want\s+to\s+find|i\s+want\s+to\s+see)\s+/i,
                /^(i\s+am\s+looking\s+for|i\s+am\s+looking|i'm\s+looking\s+for|i'm\s+looking|looking\s+for|looking|look\s+for)\s+/i,
                /^(where\s+is|where\s+are|where\s+can\s+i\s+find|where\s+do\s+i\s+find)\s+/i,
                /^(how\s+do\s+i\s+get\s+to|how\s+to\s+get\s+to|way\s+to|directions\s+to)\s+/i,
                /^(take\s+me\s+to|guide\s+me\s+to|navigate\s+to|show\s+me|find\s+me|find|locate|point\s+me\s+to)\s+/i,
                /^(the|a|an)\s+/i
            ];
            let changed = true;
            while (changed) {
                changed = false;
                for (const pat of leadingPatterns) {
                    if (pat.test(q)) {
                        q = q.replace(pat, '').trim();
                        changed = true;
                    }
                }
            }
            q = q.replace(/['’]s\s+office\s+located$/i, '');
            q = q.replace(/['’]s\s+office$/i, '');
            q = q.replace(/\s+(office\s+located|is\s+located|located|office|please)$/i, '');
            q = q.replace(/^(the|a|an)\s+/i, '').trim();
            return q;
        },

        /**
         * High-precision offline campus NLP parser
         * Resolves intents and parameters locally without server dependencies
         */
        parseOffline(query) {
            if (!query || !query.trim()) return null;
            const q = query.trim().replace(/[?!.,]+$/g, '').trim();
            const lower = q.toLowerCase();

            // 1. Amenity intent
            const amenityKeywords = [
                { type: 'food', terms: ['food', 'eat', 'eating', 'canteen', 'cafeteria', 'chop bar', 'snack', 'restaurant', 'lunch', 'breakfast'] },
                { type: 'washroom', terms: ['toilet', 'washroom', 'restroom', 'wc', 'urinal', 'bathroom'] },
                { type: 'atm', terms: ['atm', 'bank', 'cash', 'money', 'momo'] },
                { type: 'print', terms: ['print', 'printing', 'photocopy', 'photocopying', 'stationery', 'xerox'] },
                { type: 'clinic', terms: ['clinic', 'hospital', 'first aid', 'health centre', 'infirmary', 'nurse', 'medical'] },
                { type: 'library', terms: ['library', 'books', 'quiet study', 'study area'] }
            ];

            let matchedAmenity = null;
            for (const ak of amenityKeywords) {
                if (ak.terms.some(t => new RegExp(`\\b${t}\\b`, 'i').test(lower))) {
                    matchedAmenity = ak.type;
                    break;
                }
            }

            const nearMatch = lower.match(/\b(?:near|around|close to|at|next to|beside)\s+([a-z0-9\s]+)$/i);
            const landmark = nearMatch ? nearMatch[1].trim() : '';

            if (matchedAmenity && (landmark || lower.includes('where can i') || lower.includes('find') || lower.includes('where is'))) {
                return {
                    success: true,
                    action: 'find_amenity',
                    parameters: {
                        amenity_type: matchedAmenity,
                        near_landmark: landmark
                    },
                    confidence: 0.95,
                    offline: true,
                    raw_query: query
                };
            }

            // 2. Route intent
            const routeRegex = /^(?:please\s+)?(?:can\s+you\s+)?(?:take|navigate|guide|lead|route|walk|bring)\s+(?:me\s+)?(?:to\s+)?(.+)$/i;
            const dirRegex = /^(?:directions\s+to|how\s+do\s+i\s+get\s+to|way\s+to|go\s+to)\s+(.+)$/i;
            const rMatch = q.match(routeRegex) || q.match(dirRegex);
            if (rMatch) {
                const target = this.cleanQuery(rMatch[1]) || rMatch[1].trim();
                return {
                    success: true,
                    action: 'route_to',
                    parameters: { target, mode: 'walking' },
                    confidence: 0.95,
                    offline: true,
                    raw_query: query
                };
            }

            // 3. Staff intent
            const staffRegex = /^(?:find\s+(?:lecturer|prof(?:essor)?\.?|dr\.?|doctor|mr\.?|mrs\.?|miss|dean|hod)\s+|office\s+of\s+|who\s+is\s+|contact\s+)(.+)$/i;
            const sMatch = q.match(staffRegex);
            if (sMatch) {
                const name = this.cleanQuery(sMatch[1]) || sMatch[1].trim();
                return {
                    success: true,
                    action: 'find_staff',
                    parameters: { name },
                    confidence: 0.92,
                    offline: true,
                    raw_query: query
                };
            }

            // 4. Locate place or entity
            const cleaned = this.cleanQuery(q);
            return {
                success: true,
                action: 'locate_place',
                parameters: { place_name: cleaned || q },
                confidence: 0.88,
                offline: true,
                raw_query: query
            };
        },

        /**
         * Direct Cerebras Cloud AI query (ultra-low latency Llama)
         */
        async queryCerebras(query) {
            const apiKey = (typeof window !== 'undefined' && window.CEREBRAS_API_KEY) || 
                           (typeof process !== 'undefined' && process.env && process.env.CEREBRAS_API_KEY) || '';
            if (!apiKey) return null;

            try {
                const ctrl = new AbortController();
                const timeoutId = setTimeout(() => ctrl.abort(), 4000);

                const systemPrompt = `You are Navi, the official intelligent voice AI guide for USTED Kumasi campus (Ghana).
You have full spatial and academic knowledge of the campus:
- Main Buildings & Halls: USTED Library, ROB Block (Lecture Block), CBT Building, NFB, NLB, Executive Students Association (ESA) Block, Opoku Ware II Hall, Atwima Hall, Faculty of Technical Education (FBR), Main Administration Block, Great Hall, Cafeteria, Campus Clinic / Health Centre, Sports Complex.
- Departments & Offices: Department of Languages (ROB Block, Room 007), Department of Management (ROB Block, Room 022), Department of Accounting (ROB Block), Department of Interdisciplinary Studies / DIS (ROB Block, Room 023).
- Key Staff & Faculty: Dr. Kotor Asare (ROB Block, 1st Floor, Room 018), Prof. Stella Appiah (ESA Block, Room 17), etc.
- Amenities: Cafeteria (food near Halls and ROB Block), Campus Clinic (medical care), ATMs, Library (quiet study).

Given a student's natural language request, understand their real intent and output ONLY a valid JSON object without markdown fences:
{
  "action": "route_to" | "locate_place" | "find_staff" | "find_amenity" | "conversational" | "unknown_place",
  "parameters": {
    "target": "building, department, room or landmark name",
    "name": "staff member name if asking about a person",
    "amenity_type": "food | washroom | atm | clinic | library | print",
    "message": "helpful answer for conversational or general questions"
  },
  "speech_text": "A friendly, natural voice sentence to speak to the student (e.g. 'Dr. Kotor Asare\\'s office is in ROB Block, Room 018. Routing you there now.')"
}`;

                const resp = await fetch('https://api.cerebras.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'llama3.1-70b',
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: query }
                        ],
                        temperature: 0.1,
                        max_tokens: 350
                    }),
                    signal: ctrl.signal
                });
                clearTimeout(timeoutId);

                if (resp.ok) {
                    const data = await resp.json();
                    const rawContent = data?.choices?.[0]?.message?.content?.trim() || '';
                    const cleaned = rawContent.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
                    const parsed = JSON.parse(cleaned);
                    if (parsed && parsed.action) {
                        parsed.success = true;
                        parsed.source = 'cerebras_ai';
                        parsed.raw_query = query;
                        return parsed;
                    }
                }
            } catch (err) {}
            return null;
        },

        /**
         * Direct Groq Cloud AI query (ultra-fast cloud reasoning)
         */
        async queryGroq(query) {
            const apiKey = (typeof window !== 'undefined' && window.GROQ_API_KEY) || 
                           (typeof process !== 'undefined' && process.env && process.env.GROQ_API_KEY) || '';
            if (!apiKey) return null;

            try {
                const ctrl = new AbortController();
                const timeoutId = setTimeout(() => ctrl.abort(), 6000);

                const systemPrompt = `You are Navi, the official intelligent voice AI guide for USTED Kumasi campus (Ghana).
You have full spatial and academic knowledge of the campus:
- Main Buildings & Halls: USTED Library, ROB Block (Lecture Block), CBT Building, NFB, NLB, Executive Students Association (ESA) Block, Opoku Ware II Hall, Atwima Hall, Faculty of Technical Education (FBR), Main Administration Block, Great Hall, Cafeteria, Campus Clinic / Health Centre, Sports Complex.
- Departments & Offices: Department of Languages (ROB Block, Room 007), Department of Management (ROB Block, Room 022), Department of Accounting (ROB Block), Department of Interdisciplinary Studies / DIS (ROB Block, Room 023).
- Key Staff & Faculty: Dr. Kotor Asare (ROB Block, 1st Floor, Room 018), Prof. Stella Appiah (ESA Block, Room 17), etc.
- Amenities: Cafeteria (food near Halls and ROB Block), Campus Clinic (medical care), ATMs, Library (quiet study).

Given a user's natural query, understand their real intent and output ONLY a valid JSON object without markdown fences:
{
  "action": "route_to" | "locate_place" | "find_staff" | "find_amenity" | "conversational" | "unknown_place",
  "parameters": {
    "target": "building, department, room or landmark name",
    "name": "staff member name if asking about a person",
    "amenity_type": "food | washroom | atm | clinic | library | print",
    "message": "helpful answer for conversational or general questions"
  },
  "speech_text": "A friendly, natural voice sentence to speak to the student (e.g. 'Dr. Kotor Asare\\'s office is in ROB Block, Room 018. Routing you there now.')"
}`;

                const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'qwen/qwen3.8-27b',
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: query }
                        ],
                        temperature: 0.1,
                        max_tokens: 350
                    }),
                    signal: ctrl.signal
                });
                clearTimeout(timeoutId);

                if (resp.ok) {
                    const data = await resp.json();
                    const rawContent = data?.choices?.[0]?.message?.content?.trim() || '';
                    const cleaned = rawContent.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
                    const parsed = JSON.parse(cleaned);
                    if (parsed && parsed.action) {
                        parsed.success = true;
                        parsed.source = 'groq_ai';
                        parsed.raw_query = query;
                        return parsed;
                    }
                }
            } catch (err) {
                // Silently fallback to offline local NLP parser
            }
            return null;
        },

        /**
         * Parse natural language query into structured action
         * Cascade:
         * 1. Cerebras Ultra-Fast Cloud AI (when key present & online)
         * 2. Direct Groq Cloud AI Intelligence (when key present & online)
         * 3. Cloud Navi (Needle 2 + Groq / Cerebras cloud intelligence when online)
         * 4. Local Sidecar (Desktop / Device local Needle engine)
         * 5. Instant 0ms Local Offline Campus Engine (PWA offline fallback)
         */
        async parse(query) {
            if (!query || !query.trim()) return null;
            const q = query.trim();

            // TIER 0: Cerebras Ultra-Fast Cloud AI
            const cerebrasResult = await this.queryCerebras(q);
            if (cerebrasResult && cerebrasResult.success) {
                return cerebrasResult;
            }

            // TIER 1: Direct Groq Cloud AI
            const groqResult = await this.queryGroq(q);
            if (groqResult && groqResult.success) {
                return groqResult;
            }

            // TIER 2: Cloud Navi (when online & configured)
            const parseUrl = this.getCloudEndpoint('/parse');
            const isOnline = typeof navigator === 'undefined' || navigator.onLine;

            if (parseUrl && isOnline) {
                try {
                    const ctrl = new AbortController();
                    const timeoutId = setTimeout(() => ctrl.abort(), 4000);
                    const resp = await fetch(parseUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: q }),
                        signal: ctrl.signal
                    });
                    clearTimeout(timeoutId);

                    if (resp.ok) {
                        const data = await resp.json();
                        if (data && data.success) {
                            this.isCloudAvailable = true;
                            data.source = 'cloud';
                            return data;
                        }
                    }
                } catch (err) {
                    console.warn('[NaviBridge] Cloud Navi timeout/error, falling back to local engine');
                }
            }

            // TIER 3: Local Sidecar (when active)
            if (this.isAvailable) {
                try {
                    const ctrl = new AbortController();
                    const timeoutId = setTimeout(() => ctrl.abort(), 1000);
                    const resp = await fetch(`${this.sidecarUrl}/parse`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: q }),
                        signal: ctrl.signal
                    });
                    clearTimeout(timeoutId);

                    if (resp.ok) {
                        const data = await resp.json();
                        data.source = 'local_sidecar';
                        return data;
                    }
                } catch (err) {
                    this.isAvailable = false;
                    console.warn('[NaviBridge] Sidecar went offline, switching to instant offline engine');
                }
            }

            // TIER 4: Zero-delay local offline parser
            const offlineResult = this.parseOffline(q);
            if (offlineResult) {
                offlineResult.source = 'offline_local';
            }
            return offlineResult;
        },

        /**
         * Resolves destination entity from CampusOS datasets
         */
        resolveEntity(nameQuery, bData, pData, preferredType = null) {
            if (!nameQuery) return null;
            const clean = this.cleanQuery(nameQuery);
            const qRaw = (clean || nameQuery).toLowerCase().trim();
            const q = qRaw.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
            const qTokens = q.split(' ').filter(t => t.length > 0);
            const titles = new Set(['dr', 'prof', 'mr', 'mrs', 'ms', 'miss', 'doctor', 'professor', 'rev', 'arc', 'assoc', 'engr']);
            const qMeaningful = qTokens.filter(t => !titles.has(t));

            const buildings = bData || (typeof window !== 'undefined' && window.CampusOS && typeof window.CampusOS.getBuildingsData === 'function' ? window.CampusOS.getBuildingsData() : []) || (typeof window !== 'undefined' && window.buildingsData ? window.buildingsData : []) || [];
            const people = pData || (typeof window !== 'undefined' && window.CampusOS && typeof window.CampusOS.getPeopleData === 'function' ? window.CampusOS.getPeopleData() : []) || (typeof window !== 'undefined' && window.peopleData ? window.peopleData : []) || [];

            const matchToBuilding = (p) => {
                let bOffice = null;
                const bCode = (p.location?.building || p.building || p.buildingName || p.buildingId || '').toLowerCase().trim();
                const bId = p.location?.targetBuildingId !== undefined ? String(p.location.targetBuildingId).toLowerCase() : '';
                if (bId) {
                    bOffice = buildings.find(b => String(b.id).toLowerCase() === bId);
                }
                if (!bOffice && bCode) {
                    bOffice = buildings.find(b => 
                        (b.id && String(b.id).toLowerCase() === bCode) ||
                        (b.shortName && b.shortName.toLowerCase() === bCode) ||
                        (b.name && b.name.toLowerCase() === bCode) ||
                        (b.name && b.name.toLowerCase().includes(bCode)) ||
                        (bCode.includes(b.name.toLowerCase())) ||
                        (b.shortName && bCode.includes(b.shortName.toLowerCase()))
                    );
                }
                return {
                    type: 'staff',
                    data: { ...p, name: p.name || p.full_name },
                    building: bOffice
                };
            };

            // 1. Staff Name lookup
            const findStaffByName = () => {
                for (const p of people) {
                    const pName = (p.name || p.full_name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
                    if (!pName) continue;
                    const pTokens = pName.split(' ');
                    
                    if (pName === q || pName.includes(q) || (qMeaningful.length > 0 && pName.includes(qMeaningful.join(' ')))) {
                        return matchToBuilding(p);
                    }
                    if (qMeaningful.length > 0 && qMeaningful.every(t => pTokens.includes(t))) {
                        return matchToBuilding(p);
                    }
                }
                return null;
            };

            // 2. Exact Building Match
            const findExactBuildingMatch = () => {
                const bDirect = buildings.find(b => 
                    (b.name && b.name.toLowerCase() === q) ||
                    (b.shortName && b.shortName.toLowerCase() === q)
                );
                if (bDirect) return { type: 'building', data: bDirect, building: bDirect };
                return null;
            };

            // 3. Room lookup (checks b.rooms)
            const findRoomMatch = () => {
                for (const b of buildings) {
                    if (b.rooms && Array.isArray(b.rooms)) {
                        const rMatch = b.rooms.find(r => {
                            const rNum = (r.number || '').toLowerCase().trim();
                            const rName = (r.name || '').toLowerCase().trim();
                            const rDesc = (r.description || '').toLowerCase().trim();
                            const rKeys = (r.keywords || []).map(k => (k || '').toLowerCase().trim()).filter(Boolean);

                            return (rNum && (rNum === q || rNum.includes(q) || (rNum.length > 3 && q.includes(rNum)))) ||
                                   (rName && (rName === q || rName.includes(q) || (rName.length > 3 && q.includes(rName)))) ||
                                   (rDesc && rDesc.length > 3 && rDesc.includes(q)) ||
                                   rKeys.some(k => k === q || k.includes(q) || (k.length > 3 && q.includes(k)));
                        });
                        if (rMatch) {
                            return { type: 'room', data: rMatch, building: b };
                        }
                    }
                }
                return null;
            };

            // 4. Fuzzy / Substring Building Match
            const findBuildingMatch = () => {
                const bDirect = buildings.find(b => 
                    (b.name && (b.name.toLowerCase().includes(q) || (q.length > 3 && q.includes(b.name.toLowerCase())))) ||
                    (b.shortName && (q.length > 2 && q.includes(b.shortName.toLowerCase()))) ||
                    (b.keywords && b.keywords.some(k => k && (k.toLowerCase() === q || (k.length > 2 && q.includes(k.toLowerCase())))))
                );
                if (bDirect) return { type: 'building', data: bDirect, building: bDirect };
                return null;
            };

            // 5. Service lookup
            const findServiceMatch = () => {
                for (const b of buildings) {
                    if (b.services && Array.isArray(b.services)) {
                        const sMatch = b.services.find(s => {
                            const sName = (typeof s === 'string' ? s : s.name || '').toLowerCase().trim();
                            return sName && (sName === q || sName.includes(q) || (sName.length > 3 && q.includes(sName)));
                        });
                        if (sMatch) {
                            return { type: 'service', data: sMatch, building: b };
                        }
                    }
                }
                return null;
            };

            // 6. Staff By Department / Role
            const findStaffByDeptOrRole = () => {
                for (const p of people) {
                    const pDept = (p.department || p.faculty || '').toLowerCase();
                    const pRole = (p.position || p.role || '').toLowerCase();
                    if ((pDept && pDept.includes(q)) || (pRole && pRole.includes(q))) {
                        return matchToBuilding(p);
                    }
                }
                return null;
            };

            // Preferred routing
            if (preferredType === 'staff') {
                return findStaffByName() || findStaffByDeptOrRole() || findRoomMatch() || findExactBuildingMatch() || findBuildingMatch() || findServiceMatch();
            }
            if (preferredType === 'room') {
                return findRoomMatch() || findExactBuildingMatch() || findBuildingMatch() || findStaffByName() || findServiceMatch();
            }
            return findStaffByName() || findExactBuildingMatch() || findRoomMatch() || findBuildingMatch() || findStaffByDeptOrRole() || findServiceMatch();
        },

        /**
         * Dispatches structured action into CampusOS map and UI
         */
        execute(parseResult) {
            if (!parseResult) return false;
            const { action, parameters, speech_text } = parseResult;
            const bData = (typeof window !== 'undefined' && window.CampusOS ? window.CampusOS.getBuildingsData() : []) || [];
            const pData = (typeof window !== 'undefined' && window.peopleData ? window.peopleData : []) || [];

            console.log('[NaviBridge] Executing action:', action, parameters);

            switch (action) {
                case 'route_to': {
                    const target = parameters.target || parameters.place_name;
                    const entity = this.resolveEntity(target, bData, pData);
                    if (entity && entity.building) {
                        const b = entity.building;
                        const destName = entity.type === 'room' 
                            ? `${b.name} (${entity.data.name || entity.data.number || target})`
                            : (entity.type === 'staff' ? `${entity.data.name} (${b.name})` : b.name);

                        const speech = speech_text || `Routing to ${destName}`;
                        this.notify(speech + '...');
                        this.speak(speech);
                        this.setAssistantState('success', {
                            query: target,
                            speechText: speech,
                            statusText: 'Navigating to ' + destName,
                            suggestions: [{ name: destName, building: b }]
                        });
                        this.autoHideVoiceUI(3500);
                        if (this.triggerCampusRoute(b.lat, b.lng, destName)) {
                            return true;
                        }
                    }

                    // Friendly fuzzy recovery when direct entity resolution fails
                    const suggestions = this.getFuzzySuggestions(target, bData, pData, 3);
                    let politeMsg = speech_text || '';
                    if (!politeMsg) {
                        if (suggestions.length > 0 && suggestions[0].score >= 0.42) {
                            const best = suggestions[0];
                            politeMsg = `I couldn't find an exact match for "${target}", but did you mean ${best.name}?`;
                        } else {
                            politeMsg = `I'm sorry, I couldn't find "${target}" on the USTED Kumasi campus map. Would you like to check our campus facilities or search the directory?`;
                        }
                    }
                    this.notify(politeMsg);
                    this.speak(politeMsg);
                    this.setAssistantState('confused', {
                        query: target,
                        speechText: politeMsg,
                        suggestions: suggestions.length > 0 ? suggestions : this.getDefaultLandmarks(bData),
                        statusText: 'Location Not Pinpointed'
                    });
                    this.fallbackSearch(target);
                    return false;
                }

                case 'locate_place': {
                    const placeName = parameters.place_name || parameters.target;
                    const entity = this.resolveEntity(placeName, bData, pData);
                    if (entity && entity.building) {
                        const b = entity.building;
                        const destName = entity.type === 'room' 
                            ? `${b.name} (${entity.data.name || entity.data.number || placeName})`
                            : (entity.type === 'staff' ? `${entity.data.name} (${b.name})` : b.name);

                        const speech = speech_text || (entity.type === 'staff'
                            ? `${entity.data.name}'s office is at ${b.name}`
                            : `Found ${destName}`);
                        this.notify(speech);
                        this.speak(speech);
                        this.setAssistantState('success', {
                            query: placeName,
                            speechText: speech,
                            statusText: 'Located ' + destName,
                            suggestions: [{ name: destName, building: b }]
                        });
                        this.autoHideVoiceUI(3500);

                        if (!this.triggerCampusRoute(b.lat, b.lng, destName)) {
                            this.flyToBuilding(b);
                            if (typeof window.showBuilding === 'function') {
                                setTimeout(() => window.showBuilding(b), 850);
                            }
                        }
                        return true;
                    }

                    // Friendly fuzzy recovery
                    const suggestions = this.getFuzzySuggestions(placeName, bData, pData, 3);
                    let politeMsg = '';
                    if (suggestions.length > 0 && suggestions[0].score >= 0.42) {
                        const best = suggestions[0];
                        politeMsg = `I couldn't pinpoint "${placeName}", but did you mean ${best.name}?`;
                    } else {
                        politeMsg = `I'm sorry, I couldn't find "${placeName}" on the USTED Kumasi campus map.`;
                    }
                    this.notify(politeMsg);
                    this.speak(politeMsg);
                    this.setAssistantState('confused', {
                        query: placeName,
                        speechText: politeMsg,
                        suggestions: suggestions.length > 0 ? suggestions : this.getDefaultLandmarks(bData),
                        statusText: 'Place Not Found'
                    });
                    this.fallbackSearch(placeName);
                    return false;
                }

                case 'find_staff': {
                    const staffQuery = parameters.name || parameters.role || parameters.department;
                    const entity = this.resolveEntity(staffQuery, bData, pData, 'staff');
                    if (entity && entity.type === 'staff') {
                        const p = entity.data;
                        const b = entity.building;
                        const destName = b ? `${p.name} (${b.name})` : p.name;
                        const speech = speech_text || `${p.name}'s office is at ${b ? b.name : 'the campus'}`;
                        this.notify(`Found ${p.name}`);
                        this.speak(speech);
                        this.setAssistantState('success', {
                            query: staffQuery,
                            speechText: speech,
                            statusText: 'Staff Member Found',
                            suggestions: b ? [{ name: destName, building: b }] : []
                        });
                        this.autoHideVoiceUI(3500);

                        if (!b || !this.triggerCampusRoute(b.lat, b.lng, destName)) {
                            if (b) this.flyToBuilding(b);
                            if (typeof window.showStaff === 'function') {
                                setTimeout(() => window.showStaff(p, b), 850);
                            }
                        }
                        return true;
                    }

                    const suggestions = this.getFuzzySuggestions(staffQuery, bData, pData, 3);
                    const politeMsg = `I'm sorry, I couldn't find "${staffQuery}" in the campus directory. You can check the department directory below.`;
                    this.notify(politeMsg);
                    this.speak(politeMsg);
                    this.setAssistantState('confused', {
                        query: staffQuery,
                        speechText: politeMsg,
                        suggestions: suggestions.length > 0 ? suggestions : this.getDefaultLandmarks(bData),
                        statusText: 'Staff Not Found'
                    });
                    this.fallbackSearch(staffQuery);
                    return false;
                }

                case 'find_amenity': {
                    const amenity = (parameters.amenity_type || '').toLowerCase();
                    const near = (parameters.near_landmark || '').toLowerCase();
                    
                    // Match amenities across buildings
                    const matches = [];
                    for (const b of bData) {
                        const bName = (b.name || '').toLowerCase();
                        const bDesc = (b.description || '').toLowerCase();
                        const facs = (b.facilities || []).map(f => (f || '').toLowerCase());
                        const servs = (b.services || []).map(s => ((typeof s === 'string' ? s : s.name) || '').toLowerCase());
                        
                        let matchScore = 0;
                        if (facs.some(f => f.includes(amenity)) || servs.some(s => s.includes(amenity))) matchScore += 3;
                        if (bDesc.includes(amenity) || bName.includes(amenity)) matchScore += 2;
                        if (near && (bName.includes(near) || bDesc.includes(near))) matchScore += 5;

                        if (matchScore > 0) matches.push({ building: b, score: matchScore });
                    }

                    matches.sort((a, b) => b.score - a.score);

                    if (matches.length > 0) {
                        const top = matches[0].building;
                        const speech = `Routing to ${amenity} at ${top.name}`;
                        this.notify(speech + '...');
                        this.speak(speech);
                        this.setAssistantState('success', {
                            query: amenity,
                            speechText: speech,
                            statusText: 'Amenity Located',
                            suggestions: [{ name: `${amenity.toUpperCase()} • ${top.name}`, building: top }]
                        });
                        this.autoHideVoiceUI(3500);

                        if (!this.triggerCampusRoute(top.lat, top.lng, top.name)) {
                            this.flyToBuilding(top);
                            if (typeof window.showBuilding === 'function') {
                                setTimeout(() => window.showBuilding(top), 850);
                            }
                        }
                        return true;
                    }

                    const politeMsg = `I couldn't locate "${amenity}" on campus. Let me show campus amenities in the directory.`;
                    this.notify(politeMsg);
                    this.speak(politeMsg);
                    this.setAssistantState('confused', {
                        query: amenity,
                        speechText: politeMsg,
                        suggestions: this.getDefaultLandmarks(bData),
                        statusText: 'Facility Not Found'
                    });
                    this.fallbackSearch(amenity);
                    return false;
                }

                case 'conversational': {
                    const msg = parameters.message || parameters.reply || parseResult.speech_text || 'Hello! I am Navi, your campus guide. Ask me for directions or places around USTED Kumasi.';
                    this.notify(msg);
                    this.speak(msg);
                    this.setAssistantState('speaking', {
                        query: parseResult.raw_query || '',
                        speechText: msg,
                        statusText: 'Navi AI Guide',
                        suggestions: this.getDefaultLandmarks(bData)
                    });
                    return true;
                }

                case 'unknown_place': {
                    const target = parameters.place_name || parameters.target || 'that location';
                    const suggestions = this.getFuzzySuggestions(target, bData, pData, 3);
                    const politeMsg = parseResult.speech_text || `I'm sorry, I couldn't find "${target}" on the USTED Kumasi campus map. Would you like to check nearby facilities or search our directory?`;
                    this.notify(politeMsg);
                    this.speak(politeMsg);
                    this.setAssistantState('confused', {
                        query: target,
                        speechText: politeMsg,
                        suggestions: suggestions.length > 0 ? suggestions : this.getDefaultLandmarks(bData),
                        statusText: 'Location Not Found'
                    });
                    this.fallbackSearch(target);
                    return false;
                }

                default: {
                    const fallbackTarget = parameters.place_name || parameters.target || '';
                    const speech = parseResult.speech_text || (fallbackTarget ? `Searching for ${fallbackTarget}` : 'How can I assist you on campus?');
                    this.speak(speech);
                    this.setAssistantState('confused', {
                        query: fallbackTarget,
                        speechText: speech,
                        suggestions: this.getDefaultLandmarks(bData),
                        statusText: 'Directory Search'
                    });
                    this.fallbackSearch(fallbackTarget);
                    return false;
                }
            }
        },

        triggerCampusRoute(lat, lng, name) {
            if (typeof window === 'undefined') return false;
            if (typeof window.startRoute === 'function') {
                window.startRoute(lat, lng, name);
                return true;
            }
            if (window.CampusOS && typeof window.CampusOS.startRoute === 'function') {
                window.CampusOS.startRoute(lat, lng, name);
                return true;
            }
            if (typeof window.RouteModule !== 'undefined' && typeof window.RouteModule.calculateRoute === 'function') {
                window.RouteModule.calculateRoute(lat, lng, name);
                return true;
            }
            return false;
        },

        flyToBuilding(b) {
            if (!b || typeof window === 'undefined') return;
            if (window.ViewControllerModule && window.ViewControllerModule.getMode() === '3D') {
                window.CesiumViewerModule?.syncCameraFrom2D(b.lng, b.lat, 18);
            }
            if (window.map && typeof window.map.flyTo === 'function') {
                window.map.flyTo({ center: [b.lng, b.lat], zoom: 19, duration: 800, essential: true });
            }
        },

        fallbackSearch(text) {
            // When using Navi Voice Assistant, do NOT hijack #searchInput or trigger the map search dropdown
            // Suggestions are presented directly in the assistant overlay sheet.
            return;
        },

        notify(msg) {
            if (typeof window !== 'undefined' && window.CampusOS && typeof window.CampusOS.showToast === 'function') {
                window.CampusOS.showToast(msg);
            } else if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
                window.showToast(msg);
            } else {
                console.log('[NaviBridge Notification]:', msg);
            }
        },

        /**
         * Main entry point: parses natural text and dispatches immediately
         */
        async askNavi(query) {
            this.notify('Asking Navi...');
            this.setAssistantState('thinking', { 
                query: query, 
                statusText: 'Thinking...' 
            });
            const parseResult = await this.parse(query);
            if (parseResult && parseResult.success) {
                return this.execute(parseResult);
            } else {
                return this.execute({
                    action: 'unknown_place',
                    parameters: { place_name: query },
                    raw_query: query
                });
            }
        },

        // Backward compatibility alias
        askCharlie(query) {
            return this.askNavi(query);
        }
    };

    // Auto-check health in browser environment
    if (typeof window !== 'undefined') {
        window.NaviBridge = NaviBridge;
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', () => {
                NaviBridge.checkHealth();
            });
        } else {
            // Already loaded or restored from PWA cache: execute health check immediately!
            NaviBridge.checkHealth();
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = NaviBridge;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
