import { createContext, useContext } from 'react';

/** Permite que una pantalla (p. ej. la tarjeta "Asistente IA" del Inicio) abra el panel del asistente que vive en el shell. */
export const AssistantContext = createContext<{ open: () => void }>({ open: () => undefined });
export const useAssistant = () => useContext(AssistantContext);
