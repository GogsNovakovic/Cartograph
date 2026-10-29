-- What a CommonJS file exports, as the parser wrote it: exact names, or
-- where and why they couldn't be read. Null for a file that never refers to
-- module.exports or exports. Read back through the parser's own reader, like
-- coverage, so its shape is checked there rather than here.
alter table public.files
  add column commonjs_exports jsonb;
