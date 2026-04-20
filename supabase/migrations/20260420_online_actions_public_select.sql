-- Allow all authenticated users to SELECT from online_actions.
-- Previously restricted to sessions where the user has a seat,
-- which prevented the lobby ticker from reading actions for unjoined sessions.

DROP POLICY IF EXISTS "online_actions_select" ON online_actions;
DROP POLICY IF EXISTS "online_actions_select_all_auth" ON online_actions;

CREATE POLICY "online_actions_select_all_auth"
  ON online_actions FOR SELECT TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
