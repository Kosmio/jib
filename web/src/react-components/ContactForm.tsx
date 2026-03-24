import React, { useState, useRef, useEffect } from "react";

type Props = {
  strapiUrl: string;
};

export default function ContactForm({ strapiUrl }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [altchaToken, setAltchaToken] = useState<string>("");
  const altchaRef = useRef<HTMLElement>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });

  useEffect(() => {
    // Load altcha widget client-side only (registers customElements)
    import("altcha");
  }, []);

  useEffect(() => {
    const widget = altchaRef.current;
    if (!widget) return;

    const handleStateChange = (ev: any) => {
      if (ev.detail?.state === "verified" && ev.detail?.payload) {
        setAltchaToken(ev.detail.payload);
      }
    };

    widget.addEventListener("statechange", handleStateChange);
    return () => widget.removeEventListener("statechange", handleStateChange);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");

    try {
      const response = await fetch(`${strapiUrl}/api/contact/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          captchaToken: altchaToken,
        }),
      });

      if (response.ok) {
        setStatus("success");
        setFormData({ name: "", email: "", subject: "", message: "" });
        setAltchaToken("");
        // Reset the Altcha widget so a new challenge is fetched for the next submit
        (altchaRef.current as any)?.reset?.();
      } else {
        setStatus("error");
        (altchaRef.current as any)?.reset?.();
        setAltchaToken("");
      }
    } catch {
      setStatus("error");
      (altchaRef.current as any)?.reset?.();
      setAltchaToken("");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1.5">
            Nom
          </label>
          <input
            type="text"
            id="name"
            name="name"
            required
            value={formData.name}
            onChange={handleChange}
            className="w-full px-4 py-3 bg-[#f8fafc] border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00B194]/20 focus:border-[#00B194] outline-none transition-colors"
            placeholder="Votre nom"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
            Email
          </label>
          <input
            type="email"
            id="email"
            name="email"
            required
            value={formData.email}
            onChange={handleChange}
            className="w-full px-4 py-3 bg-[#f8fafc] border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00B194]/20 focus:border-[#00B194] outline-none transition-colors"
            placeholder="votre@email.com"
          />
        </div>
      </div>
      <div>
        <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1.5">
          Sujet
        </label>
        <input
          type="text"
          id="subject"
          name="subject"
          value={formData.subject}
          onChange={handleChange}
          className="w-full px-4 py-3 bg-[#f8fafc] border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00B194]/20 focus:border-[#00B194] outline-none transition-colors"
          placeholder="L'objet de votre message"
        />
      </div>
      <div>
        <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1.5">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          value={formData.message}
          onChange={handleChange}
          className="w-full px-4 py-3 bg-[#f8fafc] border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00B194]/20 focus:border-[#00B194] outline-none transition-colors resize-vertical"
          placeholder="Décrivez votre projet ou votre question..."
        />
      </div>

      <div>
        {/* @ts-ignore — altcha-widget is a web component */}
        <altcha-widget
          ref={altchaRef}
          challengeurl={`${strapiUrl}/api/captcha/challenge`}
          auto="onfocus"
          hidefooter
          style={{ maxWidth: "100%" } as any}
        />
      </div>

      {status === "success" && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          Votre message a bien été envoyé. Nous reviendrons vers vous rapidement.
        </div>
      )}
      {status === "error" && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          Une erreur est survenue. Veuillez réessayer.
        </div>
      )}

      <button
        type="submit"
        disabled={status === "loading"}
        className={`w-full sm:w-auto px-8 py-3 rounded-lg font-semibold text-sm text-white transition-colors ${
          status === "loading"
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-[#00B194] hover:bg-[#009B81]"
        }`}
      >
        {status === "loading" ? "Envoi en cours..." : "Envoyer le message"}
      </button>
    </form>
  );
}
