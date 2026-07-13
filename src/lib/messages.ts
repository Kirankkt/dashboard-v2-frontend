import { api } from "./api";

export interface Message {
  id: number;
  sender_id: number;
  body: string;
  created_at: string;
  read_at: string | null;
}

export const listMessages = (token: string | null) => api<Message[]>("/messages", { token });

export const sendMessage = (token: string | null, body: string) =>
  api<Message>("/messages", { method: "POST", body: { body }, token });

export const markRead = (token: string | null) =>
  api<{ marked: number }>("/messages/read", { method: "POST", token });

export const unreadCount = (token: string | null) =>
  api<{ unread: number }>("/messages/unread", { token });
