-- Private rate-limit buckets for the public username-auth Edge Function.
-- Stores only HMAC digests; IP addresses and usernames are not written to the database.
CREATE TABLE IF NOT EXISTS public.username_auth_rate_limits (
  bucket_key text PRIMARY KEY CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);

ALTER TABLE public.username_auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.username_auth_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.username_auth_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_username_auth_rate_limit(
  p_bucket_key text,
  p_max_attempts integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_attempts integer;
  v_expiry timestamptz := now() - make_interval(secs => p_window_seconds);
BEGIN
  IF p_bucket_key !~ '^[0-9a-f]{64}$' OR p_max_attempts < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate limit arguments';
  END IF;

  INSERT INTO public.username_auth_rate_limits AS current_bucket
    (bucket_key, window_started_at, attempts)
  VALUES (p_bucket_key, now(), 1)
  ON CONFLICT (bucket_key) DO UPDATE
    SET window_started_at = CASE
          WHEN current_bucket.window_started_at <= v_expiry THEN now()
          ELSE current_bucket.window_started_at
        END,
        attempts = CASE
          WHEN current_bucket.window_started_at <= v_expiry THEN 1
          ELSE current_bucket.attempts + 1
        END
  RETURNING attempts INTO v_attempts;

  IF random() < 0.02 THEN
    DELETE FROM public.username_auth_rate_limits
    WHERE window_started_at < now() - interval '1 day';
  END IF;

  RETURN v_attempts <= p_max_attempts;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_username_auth_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_username_auth_rate_limit(text, integer, integer) TO service_role;
