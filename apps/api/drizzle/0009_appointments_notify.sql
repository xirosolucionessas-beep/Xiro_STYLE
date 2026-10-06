-- Avisa por LISTEN/NOTIFY cada vez que una cita se crea, cambia o se borra, para que la Agenda (web) se refresque sola
-- sin encuestar. El aviso solo lleva el id del negocio (nunca datos de la cita): quien escucha vuelve a pedir por la
-- API normal, que ya filtra por sesión y por alcance (propio/todas las agendas) — este canal nunca es la fuente de
-- verdad, solo la señal de "algo cambió, vuelve a preguntar".
CREATE OR REPLACE FUNCTION appointments_notify() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('appointments_changed', json_build_object('businessId', COALESCE(NEW.business_id, OLD.business_id))::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS appointments_notify_trigger ON "appointments";
--> statement-breakpoint
CREATE TRIGGER appointments_notify_trigger
AFTER INSERT OR UPDATE OR DELETE ON "appointments"
FOR EACH ROW EXECUTE FUNCTION appointments_notify();
