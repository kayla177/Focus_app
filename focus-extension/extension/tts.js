// ElevenLabs TTS Service
// Voice: Brian - Deep, Resonant and Comforting
const ELEVENLABS_API_KEY = window.CONFIG?.ELEVENLABS_API_KEY || "";
const VOICE_ID_BRIAN = window.CONFIG?.VOICE_ID || "nPczCjzI2devNBz1zQrb";

const MOTIVATIONAL_QUOTES = [
  "Discipline is choosing between what you want now, and what you want most.",
  "The only way to do great work is to love what you do.",
  "Focus is the key to success. Don't lose it now.",
  "Don't watch the clock; do what it does. Keep going.",
  "You are capable of amazing things. Stay the course.",
  "Your future is created by what you do today, not tomorrow.",
  "Success is the sum of small efforts, repeated day in and day out.",
  "Believe you can and you're halfway there.",
  "Action is the foundational key to all success."
];

const FOCUS_PROMPTS = [
  "Eyes back on the prize.",
  "Stay with me here. Focus.",
  "Come back to the task at hand.",
  "Don't let your mind wander now.",
  "Reset. Refocus. You got this.",
  "Deep breath. Eyes forward.",
  "Stay sharp.",
  "Let's get back to it."
];

class FocusVoiceService {
  constructor() {
    this.apiKey = ELEVENLABS_API_KEY;
    this.voiceId = VOICE_ID_BRIAN;
    this.audioContext = null;
    this.isPlaying = false;
  }

  getRandomItem(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  async speak(text) {
    if (this.isPlaying) return; // Prevent overlapping speech
    this.isPlaying = true;

    try {
      console.log("[FocusVoice] Generating speech for:", text);
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`,
        {
          method: "POST",
          headers: {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": this.apiKey
          },
          body: JSON.stringify({
            text: text,
            model_id: "eleven_turbo_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          })
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail?.message || "TTS API Error");
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        this.isPlaying = false;
        URL.revokeObjectURL(audioUrl);
      };
      
      await audio.play();

    } catch (error) {
      console.error("[FocusVoice] Error:", error);
      this.isPlaying = false;
      // Fallback to generic beep if TTS fails?
      // For now, just log it.
    }
  }

  speakMotivation() {
    const text = this.getRandomItem(MOTIVATIONAL_QUOTES);
    this.speak(text);
  }

  speakDistraction() {
    const text = this.getRandomItem(FOCUS_PROMPTS);
    this.speak(text);
  }
}

// Export global instance
window.FocusVoice = new FocusVoiceService();
