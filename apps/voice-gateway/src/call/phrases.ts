import type { AgentLanguage } from "@vaanidesk/shared";

/**
 * Canned utterances spoken without an LLM round trip: tool-latency fillers,
 * silence re-prompts, goodbyes, transfer notices, failure apologies. Keyed by
 * the business's primary language (callers hear the configured default).
 */

type PhraseSet = Record<
  | "filler"
  | "reprompt"
  | "goodbye"
  | "transfer"
  | "abandonGoodbye"
  | "abuseWarning"
  | "failureApology",
  string
>;

const PHRASES: Record<AgentLanguage, PhraseSet> = {
  hinglish: {
    filler: "Ek second, main dekh rahi hoon.",
    reprompt: "Hello? Aap sun rahe hain?",
    goodbye: "Theek hai, dhanyavaad! Aapka din shubh rahe.",
    transfer: "Ek minute, main aapko owner se connect kar rahi hoon.",
    abandonGoodbye: "Lagta hai aap busy hain. Aap phir se call kar sakte hain. Dhanyavaad!",
    abuseWarning: "Kripya shaalinta se baat karein, warna mujhe call band karna padega.",
    failureApology: "Maaf kijiye, abhi kuch takneeki dikkat aa rahi hai.",
  },
  hindi: {
    filler: "एक क्षण रुकिए, मैं देख रही हूँ।",
    reprompt: "हैलो? क्या आप सुन रहे हैं?",
    goodbye: "ठीक है, धन्यवाद! आपका दिन शुभ हो।",
    transfer: "एक मिनट रुकिए, मैं आपको मालिक से जोड़ रही हूँ।",
    abandonGoodbye: "लगता है आप व्यस्त हैं। आप फिर से कॉल कर सकते हैं। धन्यवाद!",
    abuseWarning: "कृपया शालीनता से बात करें, वरना मुझे कॉल समाप्त करनी पड़ेगी।",
    failureApology: "क्षमा कीजिए, अभी कुछ तकनीकी समस्या आ रही है।",
  },
  english: {
    filler: "One second, let me check that for you.",
    reprompt: "Hello? Are you still there?",
    goodbye: "Alright, thank you for calling! Have a great day.",
    transfer: "One moment, I'm connecting you to the owner.",
    abandonGoodbye: "It seems you're busy. Please call again anytime. Thank you!",
    abuseWarning: "Please keep the conversation respectful, or I will have to end the call.",
    failureApology: "I'm sorry, we're having a technical issue right now.",
  },
};

export function phrase(language: AgentLanguage, key: keyof PhraseSet): string {
  return PHRASES[language][key];
}
