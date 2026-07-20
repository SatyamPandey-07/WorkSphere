"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";

interface FAQItem {
  question: string;
  answer: string;
}

const faqs: FAQItem[] = [
  {
    question: "Is WorkSphere free to use?",
    answer:
      "Yes! Finding and exploring venues on WorkSphere is completely free. We may introduce premium features for power users in the future, but our core search and community rating features will always remain free.",
  },
  {
    question: "Does WorkSphere work offline?",
    answer:
      "WorkSphere is built with an offline-first architecture. Once you load the app, core functionalities like viewing your saved venues and accessing your profile dashboard continue to work even if you lose your internet connection.",
  },
  {
    question: "How accurate is the venue data?",
    answer:
      "Our venue data is powered by real-time community contributions and integrated with reliable mapping services. Information like Wi-Fi quality, noise levels, and power outlet availability is constantly updated by users like you.",
  },
  {
    question: "Can I use WorkSphere to actually book a seat?",
    answer:
      "Currently, WorkSphere helps you find the perfect workspace and track your visits through our dashboard. Direct booking integration with partner venues is a feature we are actively working on for a future release.",
  },
  {
    question: "How does the AI search work?",
    answer:
      'Our AI-powered search uses a sophisticated 5-agent pipeline. You can type queries in plain English (like "find a quiet cafe with fast wifi and outlets"), and our AI interprets your intent, fetches real-time data, and returns the best matches tailored to your needs.',
  },
  {
    question: "Are the venue photos real?",
    answer:
      "Yes, we integrate with high-quality photo APIs like Pexels to provide beautiful, accurate representations of workspaces. Community members can also upload their own photos when submitting or reviewing a venue.",
  },
  {
    question: "How do I download a receipt for my visit?",
    answer:
      "If you log a visit or make a booking through your Profile Dashboard, you can instantly generate and download a professional PDF receipt for your records or expense reports.",
  },
  {
    question: "Can I add a venue if it's not on the map?",
    answer:
      "Absolutely! We encourage community contributions. You can use the 'Submit Venue' feature to add your favorite hidden gems to the WorkSphere map and share them with other remote workers.",
  },
];

export default function FAQAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleItem = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="w-full max-w-3xl mx-auto my-24 px-6">
      <div className="text-center mb-12">
        <span className="text-xs font-semibold tracking-widest text-blue-600 dark:text-blue-400 uppercase">
          Got Questions?
        </span>
        <h2 className="text-3xl md:text-4xl font-bold text-zinc-900 dark:text-white mt-3">
          Frequently Asked Questions
        </h2>
      </div>
      <div className="space-y-4">
        {faqs.map((faq, index) => {
          const isOpen = openIndex === index;
          return (
            <div
              key={index}
              className="border border-zinc-200 dark:border-white/10 rounded-2xl bg-white/50 dark:bg-black/20 backdrop-blur-sm overflow-hidden transition-colors"
            >
              <button
                onClick={() => toggleItem(index)}
                className="w-full px-6 cursor-pointer py-5 flex items-center justify-between text-left focus:outline-none focus-visible:ring-2 accent-ring rounded-2xl"
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${index}`}
                id={`faq-question-${index}`}
              >
                <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {faq.question}
                </span>
                <motion.div
                  initial={false}
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  className="flex-shrink-0 ml-4 text-zinc-500 dark:text-zinc-400"
                >
                  <ChevronDown className="w-5 h-5" />
                </motion.div>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={`faq-answer-${index}`}
                    role="region"
                    aria-labelledby={`faq-question-${index}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                  >
                    <div className="px-6 pb-5 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
