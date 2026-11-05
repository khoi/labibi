UPDATE "messages"
SET "blocks" = (
  SELECT jsonb_agg(
    CASE block->>'kind'
      WHEN 'voice_call' THEN jsonb_build_object(
        'kind', 'text',
        'text', COALESCE(NULLIF(block->>'farewell', ''), block->>'title', '')
      )
      WHEN 'call_request' THEN jsonb_build_object('kind', 'text', 'text', COALESCE(block->>'reason', ''))
      ELSE block
    END
    ORDER BY ordinality
  )
  FROM jsonb_array_elements("blocks") WITH ORDINALITY AS item(block, ordinality)
)
WHERE jsonb_typeof("blocks") = 'array'
  AND ("blocks" @> '[{"kind": "voice_call"}]' OR "blocks" @> '[{"kind": "call_request"}]');

UPDATE "runs" SET "trigger" = 'user' WHERE "trigger" = 'call_end';

DELETE FROM "events" WHERE "type" = 'thread.call.ended';
