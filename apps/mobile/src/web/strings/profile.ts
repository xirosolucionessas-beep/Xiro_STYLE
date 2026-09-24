/** Textos web del perfil (ES/EN), incluido el cambio de celular con verificación por código. Se fusionan en src/web/shell/strings.ts. */
export const profileEs = {
  profile_name_label: 'Nombre completo',
  phone_change_cta: 'Cambiar',
  phone_change_title: 'Cambiar celular',
  phone_new_label: 'Celular nuevo',
  phone_change_send_cta: 'Enviar código',
  phone_change_sent_note: 'Te enviamos un código de verificación por SMS al número nuevo.',
  phone_change_confirm_cta: 'Confirmar celular',
  phone_change_success: 'Celular actualizado.',
  phone_change_retry: '¿No te llegó? Vuelve a intentarlo',
  phone_none: 'Sin celular registrado',
} as const;

export type ProfileStringKey = keyof typeof profileEs;

export const profileEn: Record<ProfileStringKey, string> = {
  profile_name_label: 'Full name',
  phone_change_cta: 'Change',
  phone_change_title: 'Change phone number',
  phone_new_label: 'New phone number',
  phone_change_send_cta: 'Send code',
  phone_change_sent_note: 'We sent a verification code by SMS to the new number.',
  phone_change_confirm_cta: 'Confirm phone number',
  phone_change_success: 'Phone number updated.',
  phone_change_retry: "Didn't get it? Try again",
  phone_none: 'No phone number on file',
};
