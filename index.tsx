/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

// BOOK_CONTENT is now externalized

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = 'Click Start to ask your science tutor a question.';
  @state() error = '';
  @state() private _isSessionActive = false;
  @state() private bookContent: string | null = null;
  @state() private bookLoadingError: string | null = null;


  private client: GoogleGenAI;
  private session: Session | null = null;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100vh; /* Ensure the host takes full viewport height */
      position: relative; /* For absolute positioning of children */
    }

    #status {
      position: absolute;
      bottom: 20px; /* Adjusted for better spacing */
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      text-align: center;
      color: white;
      font-family: sans-serif;
      padding: 8px 15px;
      background-color: rgba(0, 0, 0, 0.6);
      border-radius: 8px;
      font-size: 0.9em;
      max-width: 80%;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 70px; /* Adjusted for better spacing */
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 15px; /* Increased gap */

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        border-radius: 50%; /* Make buttons circular */
        background: rgba(40, 40, 40, 0.5); /* Darker, slightly transparent background */
        backdrop-filter: blur(5px);
        width: 68px; /* Slightly larger */
        height: 68px; /* Slightly larger */
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s ease, transform 0.2s ease;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);

        &:hover {
          background: rgba(55, 55, 55, 0.7);
          transform: translateY(-2px);
        }

        &:active {
          transform: translateY(0px);
          background: rgba(30, 30, 30, 0.6);
        }
      }

      button svg {
        transition: transform 0.2s ease;
      }
      
      button:hover svg {
         transform: scale(1.1);
      }

      button[disabled] {
        display: none;
      }
    }

    gdm-live-audio-visuals-3d {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 1; /* Ensure it's behind the controls and status */
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    // Fetch book content
    try {
      this.updateStatus('Loading knowledge base...');
      this.bookLoadingError = null; // Clear previous loading errors
      const response = await fetch('./book-content.txt'); // Path relative to index.html
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      this.bookContent = await response.text();
      this.updateStatus('Knowledge base loaded. Initializing tutor...');
      await this.initSession(); // Call initSession after successfully loading content
    } catch (e: any) {
      console.error('Failed to load book content:', e);
      this.bookLoadingError = `Failed to load critical knowledge base: ${e.message}. Please try refreshing or check file.`;
      this.updateError(this.bookLoadingError); // Display error in UI
      this._isSessionActive = false; // Ensure session is not considered active
    }
  }

  private async initSession() {
    if (!this.bookContent) {
        this.updateError('Cannot initialize session: Knowledge base not loaded.');
        this._isSessionActive = false;
        return;
    }

    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    const systemInstruction = `You are Max — a friendly, patient, and encouraging Math tutor for 8th-grade students.
Your purpose is to make mathematics accessible, engaging, and understandable for teenagers who may have varying levels of confidence with math. Explain concepts in a simple, friendly, patient, and relatable way that connects with 15-16 year old students.
Think of yourself as that one amazing teacher who is – supportive, encouraging,
Your main knowledge source is the official 8th-grade Mathematics textbooks (Telangana SSC & CBSE).

### 🎙️ **Speaking Style Instructions (Voice-Only Tutor)**

* Speak in **clear, simple, and slow-paced language**.
* Match the student's language:
* You speak with warmth and clarity, just like a helpful senior or favorite teacher.
* If they speak in **English**, respond in **casual English**.
* If they speak in **Telugu**, reply in **friendly, everyday Telugu mixed with English** — like students talk with friends or siblings.
* Avoid **bookish Telugu**. Use **natural, home-style words** that 9th-graders relate to.


### **How to Explain Concepts**

* Make math **feel easy and approachable**, not scary.
* Always **explain step-by-step**, one idea at a time.
* Use **real-life examples** from shopping, cooking, cricket, mobile games, etc.
* For **formulas**, explain:

  * **Why** it works
  * **Where** it comes from
  * Not just **how** to apply it
  * Encourage curiosity

### **You Must Be Ready to Offer:**

* Chapter-wise concept explanations
* Step-by-step problem solving
* Shortcuts and smart tricks
* Key formulas with memory aids

All responses must be **age-appropriate for a 9th-grade student**.

###Important Rules

* Strictly math-focused (redirect off-topic questions politely).


Here is the textbook syllabus:
BEGIN TEXTBOOK:
${this.bookContent}
END TEXTBOOK.

Now, answer the user's questions.`;

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Math Tutor Ready. Ask your question.');
            this._isSessionActive = true;
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () =>{
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if(interrupted) {
              for(const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(`API Error: ${e.message}. Session may be unstable.`);
            this._isSessionActive = false;
            // No automatic re-initSession here to avoid loops with API key issues. Reset button is preferred.
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Session closed. Click Start or Reset.');
            this._isSessionActive = false;
            this.session = null;
          },
        },
        config: {
          systemInstruction: systemInstruction,
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Charon'}},
          },
        },
      });
      this._isSessionActive = true;
    } catch (e: any) {
      console.error(e);
      this.updateError(`Failed to initialize session: ${e.message}. Check API key and network.`);
      this._isSessionActive = false;
      this.session = null;
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = ''; 
    // Do not clear bookLoadingError here, as it's a persistent issue until resolved by refresh/reset
  }

  private updateError(msg: string) {
    this.error = msg;
    this.status = ''; 
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    if (this.bookLoadingError || !this.bookContent) {
        this.updateError('Knowledge base not loaded. Cannot start recording. Please try resetting or refreshing the page.');
        return;
    }
    
    if (!this.session || !this._isSessionActive) {
      this.updateStatus('Re-initializing session...');
      // It's better to guide user to reset if session is problematic, rather than auto-re-init here.
      // await this.initSession(); // This might be problematic if called repeatedly
      // await new Promise(resolve => setTimeout(resolve, 1000));
      if (!this.session || !this._isSessionActive) {
        this.updateError('Session is not active. Please try resetting the session.');
        return;
      }
    }

    this.inputAudioContext.resume();
    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Listening...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording || !this.session || !this._isSessionActive) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);
        
        try {
          if (this.session) {
            this.session.sendRealtimeInput({media: createBlob(pcmData)});
          }
        } catch (err: any) {
            console.error('Error sending audio data:', err);
            this.updateError(`Error sending audio: ${err.message}. Try resetting.`);
            this.stopRecording();
        }
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Listening... Ask your science question.');
    } catch (err: any) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error starting microphone: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping listener...');
    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    
    if(this.session && this._isSessionActive) {
        // Optional: this.session.sendRealtimeInput({ text: '' }); 
    }
    this.updateStatus('Listener stopped. Click Start to ask another question.');
  }

  private async reset() {
    this.updateStatus('Resetting session...');
    if (this.isRecording) {
        this.stopRecording();
    }
    if (this.session) {
        try {
            this.session.close();
        } catch (e) {
            console.warn("Error closing session during reset:", e);
        }
        this.session = null;
    }
    this._isSessionActive = false;
    this.bookContent = null; // Clear loaded book content
    this.bookLoadingError = null; // Clear book loading errors
    this.error = ''; // Clear general errors


    if (this.outputAudioContext && this.outputAudioContext.state !== 'closed') {
        await this.outputAudioContext.close();
    }
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    this.outputNode = this.outputAudioContext.createGain();
    this.outputNode.connect(this.outputAudioContext.destination);
    

    if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
        await this.inputAudioContext.close();
    }
    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 16000});
    this.inputNode = this.inputAudioContext.createGain();
    
    // Call initClient which handles book loading then session init
    await this.initClient(); 
  }

  render() {
    return html`
      <gdm-live-audio-visuals-3d
        .inputNode=${this.inputNode}
        .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      
      <div class="controls">
        <button
          id="resetButton"
          @click=${this.reset}
          title="Reset Session"
          aria-label="Reset Session"
          >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            height="36px" 
            viewBox="0 -960 960 960"
            width="36px"
            fill="#e0e0e0"> 
            <path
              d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
          </svg>
        </button>
        <button
          id="startButton"
          @click=${this.startRecording}
          ?disabled=${this.isRecording || !!this.bookLoadingError}
          title="Start Listening"
          aria-label="Start Listening"
          >
          <svg
            viewBox="0 0 100 100"
            width="40px" 
            height="40px"
            xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="45" fill="#c80000" stroke="#ff7f7f" stroke-width="5"/>
          </svg>
        </button>
        <button
          id="stopButton"
          @click=${this.stopRecording}
          ?disabled=${!this.isRecording}
          title="Stop Listening"
          aria-label="Stop Listening"
          >
          <svg
            viewBox="0 0 100 100"
            width="32px"
            height="32px"
            fill="#cccccc" 
            xmlns="http://www.w3.org/2000/svg">
            <rect x="15" y="15" width="70" height="70" rx="10" />
          </svg>
        </button>
      </div>

      <div id="status" role="status" aria-live="polite">
        ${this.bookLoadingError
            ? html`<b>Error:</b> ${this.bookLoadingError}`
            : this.error
            ? html`<b>Error:</b> ${this.error}`
            : this.status}
      </div>
    `;
  }
}
// Ensure tutor_image_current.png is in the root folder.