-- Tạo tài khoản và 2 database cho app Từ Vựng. Chạy lại bao nhiêu lần cũng an toàn.
do $$ begin
  if not exists (select from pg_roles where rolname = 'tuvung') then
    create role tuvung login password 'tuvung';
  else
    alter role tuvung login password 'tuvung';
  end if;
end $$;
select 'create database tuvung_dev owner tuvung'
  where not exists (select from pg_database where datname = 'tuvung_dev')\gexec
select 'create database tuvung_test owner tuvung'
  where not exists (select from pg_database where datname = 'tuvung_test')\gexec
select datname as "Database da co" from pg_database where datname like 'tuvung%' order by 1;
