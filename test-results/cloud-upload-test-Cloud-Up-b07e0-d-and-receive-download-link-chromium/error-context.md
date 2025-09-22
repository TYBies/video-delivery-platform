# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - heading "Video Upload" [level=1] [ref=e3]
    - generic [ref=e4]:
      - strong [ref=e5]: "Disk Space:"
      - text: 245.94 GB available (43% used)
    - generic [ref=e6]: "Mode: Direct-to-Cloud (Backblaze B2)"
    - generic [ref=e7]:
      - generic [ref=e8]:
        - generic [ref=e9]: "Client Name:"
        - textbox "Client Name:" [ref=e10]: E2E Test Client
      - generic [ref=e11]:
        - generic [ref=e12]: "Project Name:"
        - textbox "Project Name:" [ref=e13]: E2E Test Project
      - generic [ref=e14]:
        - generic [ref=e15]: "Video File:"
        - button "Video File:" [ref=e16]
        - generic [ref=e17]: "Selected: cloud-test-video.mp4 (0.1 MB)"
      - generic [ref=e18]:
        - heading "Video Compression (Optional)" [level=4] [ref=e19]
        - generic [ref=e21] [cursor=pointer]:
          - checkbox "Compress video to reduce file size (recommended for large files)" [ref=e22]
          - generic [ref=e23] [cursor=pointer]: Compress video to reduce file size (recommended for large files)
      - button "Upload Video" [ref=e24] [cursor=pointer]
    - generic [ref=e25]: "Error: Upload failed: Upload failed - check CORS configuration and network connection"
  - alert [ref=e26]
```