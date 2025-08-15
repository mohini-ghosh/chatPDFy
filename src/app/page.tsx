
"use client";
import React, { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Paperclip, Send, Bot, User, Trash2, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type Role = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  type?: "text" | "file";
  fileName?: string;
  fileSize?: string;
  pageCount?: number;
}

interface PendingState {
  isThinking: boolean;
  placeholder: string;
}

interface GeminiPart {
  text: string;
}
interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}
interface GeminiCandidate {
  content: GeminiContent;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

declare global {
  interface Window {
    pdfjsLib: any;
  }
}

 const GEMINI_API_KEY =process.env.NEXT_PUBLIC_GEMINI_API_KEY;



const uid = (() => {
  let c = 0;
  return () => `${Date.now()}-${c++}`;
})();

export default function ChatbotUI(): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>("");
  const [isTyping, setIsTyping] = useState(false);
  const [pending, setPending] = useState<PendingState>({ isThinking: false, placeholder: "" });
  const [parsedPDFText, setParsedPDFText] = useState<string>("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js";
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
      }
    };
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(id);
  }, [messages, pending]);

  const callGeminiAPI = async (allMessages: ChatMessage[], pdfText: string): Promise<string> => {
    try {
      const formattedMessages: GeminiContent[] = allMessages
        .filter((m) => m.type !== "file")
        .map((m, idx, arr) => {
          if (idx === arr.length - 1 && pdfText) {
            return {
              role: m.role === "user" ? "user" : "model",
              parts: [{ text: `${m.content}\n\n---\nPDF Content:\n${pdfText}` }],
            };
          }
          return {
            role: m.role === "user" ? "user" : "model",
            parts: [{ text: m.content }],
          };
        });

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: formattedMessages }),
        }
      );

      if (!res.ok) return `API request failed with status ${res.status}`;

      const data: GeminiResponse = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "Sorry, I couldn't understand that.";
    } catch (err) {
      console.error("Error calling Gemini API:", err);
      return "Oops! Something went wrong while getting the answer.";
    }
  };

  const sendMessage = async (): Promise<void> => {
    const trimmed = input.trim();
    if (!trimmed || pending.isThinking) return;

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
      type: "text",
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setIsTyping(false);
    setPending({ isThinking: true, placeholder: "Typing...." });

    const replyText = await callGeminiAPI(updatedMessages, parsedPDFText)

    const botMsg: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: replyText,
      createdAt: Date.now(),
      type: "text",
    };

    setMessages((prev) => [...prev, botMsg]);
    setPending({ isThinking: false, placeholder: "" });
    setParsedPDFText("");
  };

  const clearChat = (): void => {
    setMessages([]);
    setPending({ isThinking: false, placeholder: "" });
    setParsedPDFText("");
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handlePDFUpload = async (files: FileList) => {
    if (!window.pdfjsLib) {
      console.error("PDF.js not loaded yet!");
      return;
    }

    let combinedText = "";

    for (const file of Array.from(files)) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      let fullText = "";
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(" ");
        fullText += pageText + "\n";
      }

      // Append to combined text for AI
      combinedText += `\n--- PDF: ${file.name} ---\n${fullText}\n`;

      // Push file message to chat
      const fileMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: "",
        createdAt: Date.now(),
        type: "file",
        fileName: file.name,
        fileSize: formatFileSize(file.size),
        pageCount: pdf.numPages,
      };

      setMessages((prev) => [...prev, fileMsg]);
    }

    setParsedPDFText(combinedText.trim());
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <TooltipProvider>
      <div
        className="flex h-dvh w-full items-center justify-center bg-background p-2 sm:p-4"
        style={{
          backgroundImage: "url('/59271.jpg')",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <Card className="relative mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden border shadow-sm">
          {/* Header */}
          <CardHeader className="flex flex-row items-center justify-between border-b bg-card/50 px-4 py-2 sm:px-6">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <div className="font-semibold">ChatPDFy</div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={clearChat}>
                  <Trash2 className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear conversation</TooltipContent>
            </Tooltip>
          </CardHeader>

          {/* Chat Body */}
          <CardContent className="flex min-h-0 flex-1 p-0 bg-white">
            <ScrollArea className="h-full w-full p-3 sm:p-6">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                <AnimatePresence initial={false}>
                  {messages.map((m) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                      className={`flex w-full items-start gap-3 ${
                        m.role === "user" ? "flex-row-reverse text-right" : ""
                      }`}
                    >
                      <Avatar className="mt-0.5 h-8 w-8">
                        <AvatarFallback
                          className={
                            m.role === "user"
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          }
                        >
                          {m.role === "user" ? <User className="h-4 w-4" /> : <img src="/botlogo.jpg" alt="AI" className="h-8 w-8 rounded-full object-cover border" />}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex min-w-0 flex-1 flex-col">
                        <div
                          className={`whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed border ${
                            m.role === "user"
                              ? "bg-blue-200 text-black ml-auto"
                              : "bg-muted mr-auto border-transparent max-w-[60%]"
                          }`}
                        >
                          {m.type === "file" ? (
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center w-12 h-12 bg-red-100 rounded">
                                <FileText className="w-6 h-6 text-red-600" />
                              </div>
                              <div className="flex flex-col">
                                <span className="font-semibold">{m.fileName}</span>
                                <span className="text-xs text-gray-500">
                                  {m.pageCount} pages • {m.fileSize} • PDF
                                </span>
                              </div>
                            </div>
                          ) : (
                            m.content
                          )}
                        </div>
                        <div
                          className={`mt-1 text-xs text-muted-foreground ${
                            m.role === "user" ? "text-right" : "text-left"
                          }`}
                        >
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {pending.isThinking && (
                  <div className="flex items-start gap-3">
                    <Avatar className="mt-0.5 h-8 w-8">
                      <AvatarFallback className="bg-muted text-muted-foreground">
                        <img src="/botlogo.jpg" alt="AI" className="h-8 w-8 rounded-full object-cover" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="inline-flex items-center gap-2 rounded-2xl bg-muted px-4 py-2 text-sm text-blue-500 max-w-[60%]">
                        {pending.placeholder}
                      </div>
                    </div>
                  </div>
                )}

                <div ref={bottomRef} className="h-px w-full" />
              </div>
            </ScrollArea>
          </CardContent>

          <Separator />

          {/* Footer */}
          <CardFooter className="sticky bottom-0 left-0 right-0 bg-background/60 p-2 sm:p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="mx-auto flex w-full max-w-3xl items-center gap-2"
            >
              <label className="cursor-pointer flex items-center">
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      handlePDFUpload(e.target.files);
                    }
                  }}
                />
                <Paperclip className="h-5 w-5 text-black" />
              </label>

              <Textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setIsTyping(e.target.value.trim().length > 0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Type a message…"
                className="max-h-40 min-h-[44px] w-full resize-y rounded-xl text-sm"
              />

              <Button type="submit" className="gap-1" disabled={!input.trim() || pending.isThinking}>
                <Send className="h-4 w-4" />
                Send
              </Button>
            </form>
          </CardFooter>
        </Card>
      </div>
    </TooltipProvider>
  );
}
