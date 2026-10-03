// The app fixture of tests/operations/managed-restore.test.ts, which fills in objectKey and
// countsQuery when it builds it.
package main

import (
  "bytes"
  "crypto/hmac"
  "crypto/sha256"
  "encoding/hex"
  "encoding/json"
  "fmt"
  "io"
  "net/http"
  "os"
  "os/exec"
  "path/filepath"
  "strings"
  "time"
)

var version = "dev"

const objectKey = "{{objectKey}}"
const countsQuery = "{{countsQuery}}"

func main() {
  args := os.Args[1:]
  if equal(args, []string{"healthcheck"}) { healthcheck(); return }
  if equal(args, []string{"npm", "run", "--silent", "backup", "--", "--offline", "--direct", "--json", "--output-root", "/backups"}) { backup(); return }
  content := []string{"npm", "run", "--silent", "content", "--"}
  if len(args) > len(content) && equal(args[:len(content)], content) { step(args[len(content):]); return }
  if len(args) != 0 { panic("unexpected fixture command") }

  mux := http.NewServeMux()
  mux.HandleFunc("/internal/live", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
  mux.HandleFunc("/health/ready", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
  mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) { http.NotFound(w, nil) })
  if err := http.ListenAndServe(":4321", mux); err != nil { panic(err) }
}

func healthcheck() {
  response, err := http.Get("http://127.0.0.1:4321/internal/live")
  if err != nil || response.StatusCode != http.StatusNoContent { os.Exit(1) }
  _ = response.Body.Close()
}

func backup() {
  // Named as scripts/backup.ts names a backup: tomecms-<its ISO time without - : .>.
  name := "tomecms-" + strings.ReplaceAll(time.Now().UTC().Format("20060102T150405.000Z"), ".", "")
  root := filepath.Join("/backups", name)
  if err := os.MkdirAll(root, 0700); err != nil { panic(err) }
  run("pg_dump", "--format=custom", "--file", filepath.Join(root, "database.dump"))
  database, err := os.ReadFile(filepath.Join(root, "database.dump"))
  if err != nil { panic(err) }
  objects := []any{}
  response, err := http.Get("http://seaweedfs:8333/" + os.Getenv("S3_BUCKET") + "/" + objectKey)
  if err != nil { panic(err) }
  object, err := io.ReadAll(response.Body)
  _ = response.Body.Close()
  if err != nil { panic(err) }
  if response.StatusCode == http.StatusOK {
    path := filepath.Join(root, "objects", objectKey)
    if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil { panic(err) }
    if err := os.WriteFile(path, object, 0600); err != nil { panic(err) }
    objects = append(objects, map[string]any{"key": objectKey, "contentType": "image/webp", "sizeBytes": len(object), "sha256": digest(object)})
  } else if response.StatusCode != http.StatusNotFound { panic(fmt.Sprintf("object read: %d", response.StatusCode)) }
  manifest := map[string]any{
    "format": "tomecms-backup", "version": 1, "createdAt": time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
    "applicationVersion": version,
    "config": map[string]any{"publicUrl": os.Getenv("TOME_CMS_PUBLIC_URL"), "database": "fixture", "s3Endpoint": "https://media.example.test", "bucket": os.Getenv("S3_BUCKET")},
    "database": map[string]any{"file": "database.dump", "sha256": digest(database)},
    "records": json.RawMessage(psql(countsQuery)),
    "objects": objects,
  }
  bytes, err := json.MarshalIndent(manifest, "", "  ")
  if err != nil { panic(err) }
  bytes = append(bytes, '\n')
  if err := os.WriteFile(filepath.Join(root, "manifest.json"), bytes, 0600); err != nil { panic(err) }
  receipt, _ := json.Marshal(map[string]any{"backupDirectory": "/backups/" + name, "manifestSha256": digest(bytes)})
  fmt.Print(string(receipt))
}

// One step of the content CLI. FIXTURE_FAIL_STEP names a step to fail, alone or as step:<backup
// directory name>, so a rollback from another backup can run the same step and pass.
func step(args []string) {
  target := ""
  if len(args) == 3 { target = filepath.Base(args[2]) }
  if len(args) == 3 && args[0] == "restore-database" { target = filepath.Base(filepath.Dir(args[2])) }
  if fail := os.Getenv("FIXTURE_FAIL_STEP"); fail != "" && (fail == args[0] || fail == args[0]+":"+target) {
    fmt.Println(`{"ok":false,"code":"injected"}`)
    os.Exit(1)
  }
  switch {
  case len(args) == 3 && args[0] == "restore-database" && args[1] == "--dump":
    // The schema is reset first, as the real step does, so nothing the backup lacks survives.
    psql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    run("pg_restore", "--no-owner", "--exit-on-error", "--dbname", os.Getenv("PGDATABASE"), args[2])
    receipt(map[string]any{})
  case len(args) == 3 && args[0] == "restore-objects" && args[1] == "--backup":
    data, err := os.ReadFile(filepath.Join(args[2], "manifest.json"))
    if err != nil { panic(err) }
    var manifest struct { Objects []struct { Key string; ContentType string } }
    if err := json.Unmarshal(data, &manifest); err != nil { panic(err) }
    for _, object := range manifest.Objects {
      body, err := os.ReadFile(filepath.Join(args[2], "objects", object.Key))
      if err != nil { panic(err) }
      putObject(object.Key, object.ContentType, body)
    }
    receipt(map[string]any{"uploaded": len(manifest.Objects), "deleted": 0})
  case equal(args, []string{"after-restore"}):
    receipt(map[string]any{"records": json.RawMessage(psql(countsQuery)), "sealedSecrets": 0, "unopenedSecrets": []any{}})
  default:
    panic("unexpected content step")
  }
}

func receipt(fields map[string]any) {
  fields["ok"] = true
  line, err := json.Marshal(fields)
  if err != nil { panic(err) }
  fmt.Println(string(line))
}

// A PUT through the S3 API, signed with AWS Signature Version 4 as any S3 client signs it.
func putObject(key, contentType string, body []byte) {
  host := "seaweedfs:8333"
  path := "/" + os.Getenv("S3_BUCKET") + "/" + key
  stamp := time.Now().UTC().Format("20060102T150405Z")
  scope := stamp[:8] + "/us-east-1/s3/aws4_request"
  payload := digest(body)
  canonical := strings.Join([]string{"PUT", path, "", "host:" + host, "x-amz-content-sha256:" + payload, "x-amz-date:" + stamp, "",
    "host;x-amz-content-sha256;x-amz-date", payload}, "\n")
  signing := []byte("AWS4" + os.Getenv("S3_SECRET_ACCESS_KEY"))
  for _, part := range []string{stamp[:8], "us-east-1", "s3", "aws4_request"} { signing = mac(signing, part) }
  signature := hex.EncodeToString(mac(signing, strings.Join([]string{"AWS4-HMAC-SHA256", stamp, scope, digest([]byte(canonical))}, "\n")))
  request, err := http.NewRequest(http.MethodPut, "http://"+host+path, bytes.NewReader(body))
  if err != nil { panic(err) }
  request.Header.Set("Content-Type", contentType)
  request.Header.Set("X-Amz-Date", stamp)
  request.Header.Set("X-Amz-Content-Sha256", payload)
  request.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+os.Getenv("S3_ACCESS_KEY_ID")+"/"+scope+
    ", SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature="+signature)
  response, err := http.DefaultClient.Do(request)
  if err != nil { panic(err) }
  text, _ := io.ReadAll(response.Body)
  _ = response.Body.Close()
  if response.StatusCode != http.StatusOK { panic(fmt.Sprintf("object put: %d %s", response.StatusCode, text)) }
}

// psql's output, one value; its notices go to stderr, which is never parsed.
func psql(query string) string {
  command := exec.Command("psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", query)
  command.Stderr = os.Stderr
  output, err := command.Output()
  if err != nil { panic(err) }
  return strings.TrimSpace(string(output))
}

// A client tool whose output is diagnostics: stdout carries only the receipt.
func run(name string, args ...string) {
  command := exec.Command(name, args...)
  command.Stdout = os.Stderr
  command.Stderr = os.Stderr
  if err := command.Run(); err != nil { panic(err) }
}

func mac(key []byte, value string) []byte { hash := hmac.New(sha256.New, key); hash.Write([]byte(value)); return hash.Sum(nil) }
func digest(bytes []byte) string { sum := sha256.Sum256(bytes); return hex.EncodeToString(sum[:]) }
func equal(left, right []string) bool {
  if len(left) != len(right) { return false }
  for index := range left { if left[index] != right[index] { return false } }
  return true
}
