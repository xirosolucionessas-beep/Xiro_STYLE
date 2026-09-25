import { Redirect } from 'expo-router';

/**
 * Citas existe solo en la Web (agenda.web.tsx). Este archivo es el hermano sin extensión de plataforma que exige
 * Expo Router: en Android/iOS ninguna pantalla enlaza aquí, y si alguien llega por URL vuelve al inicio.
 */
export default function Agenda() {
  return <Redirect href="/" />;
}
