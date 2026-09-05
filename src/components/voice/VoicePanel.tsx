import React, { useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import {
  Mic, MicOff, Volume2, Settings2, Trash2,
} from 'lucide-react';
import './VoicePanel.css';

export function VoicePanel() {
  const voiceListening = useAppStore((s) => s.voiceListening);
  const setVoiceListening = useAppStore((s) => s.setVoiceListening);
  const voiceTranscript = useAppStore((s) => s.voiceTranscript);
  const setVoiceTranscript = useAppStore((s) => s.setVoiceTranscript);
  const addMessage = useAppStore((s) => s.addMessage);
  const messages = useAppStore((s) => s.messages);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const toggleListening = () => {
    if (voiceListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const startListening = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceTranscript('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setVoiceTranscript(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setVoiceListening(false);
    };

    recognition.onend = () => {
      setVoiceListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setVoiceListening(true);
    setVoiceTranscript('');
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setVoiceListening(false);
  };

  const sendTranscript = () => {
    if (!voiceTranscript.trim()) return;
    addMessage({
      id: `voice-${Date.now()}`,
      role: 'user',
      content: voiceTranscript.trim(),
      timestamp: Date.now(),
    });
    setVoiceTranscript('');
  };

  const speakText = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    }
  };

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');

  return (
    <div className="voice-view">
      <h2 className="view-title">Voice Interaction</h2>

      <div className="voice-main">
        {/* Mic button */}
        <div className="voice-mic-area">
          <button
            className={`voice-mic-btn ${voiceListening ? 'listening' : ''}`}
            onClick={toggleListening}
          >
            {voiceListening ? <MicOff size={32} /> : <Mic size={32} />}
          </button>
          <span className="voice-mic-label">
            {voiceListening ? 'Listening...' : 'Tap to speak'}
          </span>
          {voiceListening && (
            <div className="voice-pulse-ring" />
          )}
        </div>

        {/* Transcript */}
        <div className="voice-transcript-area">
          <div className="voice-section-header">
            <span>Transcript</span>
            {voiceTranscript && (
              <button className="voice-clear-btn" onClick={() => setVoiceTranscript('')}>
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>
          <div className="voice-transcript-box">
            {voiceTranscript ? (
              <p className="voice-transcript-text">{voiceTranscript}</p>
            ) : (
              <p className="voice-transcript-placeholder">
                Your speech will appear here...
              </p>
            )}
          </div>
          {voiceTranscript && (
            <button className="voice-send-btn" onClick={sendTranscript}>
              Send as message
            </button>
          )}
        </div>

        {/* Last response */}
        {lastAssistantMsg && (
          <div className="voice-response-area">
            <div className="voice-section-header">
              <span>Last Response</span>
              <button
                className="voice-speak-btn"
                onClick={() => speakText(lastAssistantMsg.content)}
              >
                <Volume2 size={13} /> Speak
              </button>
            </div>
            <div className="voice-response-box">
              <p>{lastAssistantMsg.content.slice(0, 500)}{lastAssistantMsg.content.length > 500 ? '...' : ''}</p>
            </div>
          </div>
        )}

        {/* Voice settings */}
        <div className="voice-settings">
          <div className="voice-section-header">
            <Settings2 size={14} />
            <span>Voice Settings</span>
          </div>
          <div className="voice-settings-grid">
            <div className="voice-setting-item">
              <label>Language</label>
              <select defaultValue="en-US">
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="es-ES">Spanish</option>
                <option value="fr-FR">French</option>
              </select>
            </div>
            <div className="voice-setting-item">
              <label>Auto-send on silence</label>
              <input type="checkbox" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
