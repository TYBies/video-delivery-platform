# 🚀 CI/CD Pipeline Documentation

This document explains the automated CI/CD pipeline for the Video Delivery Platform.

## 🏗️ Pipeline Architecture

### **Branch Strategy**

```
feature/fix/test branches → develop → main
                    ↓         ↓       ↓
                   CI    Staging  Production
```

- **Feature branches** → Auto-PR to `develop`
- **Develop branch** → Staging deployment + Auto-PR to `main`
- **Main branch** → Production deployment (manual merge only)

## 🔒 Security-First Approach

### **Security Gates** (Pipeline FAILS if any fail)

1. **NPM Audit** - Scans dependencies for high/critical vulnerabilities
2. **Audit CI** - Validates against known security advisories
3. **CodeQL Analysis** - Static application security testing (SAST)
4. **Dependency Review** - GitHub security advisory check

### **Quality Gates**

1. **ESLint** - Code style and best practices
2. **TypeScript** - Type safety validation
3. **Jest Tests** - Unit/integration test coverage (50% minimum)
4. **Build Test** - Production build validation

## 📋 Pipeline Jobs

### **CI Pipeline** (`.github/workflows/ci.yml`)

#### 1. 🔒 Security Audit

- **Runs first** - blocks everything if security issues found
- NPM audit with `--audit-level high`
- Audit CI for vulnerability scanning

#### 2. 🔍 Quality Checks

- ESLint with strict rules
- TypeScript compilation
- Jest tests with coverage requirements
- Only runs if security passes

#### 3. 🏗️ Build Test

- Production build validation
- Artifact creation for deployment
- Only runs if security + quality pass

#### 4. 🛡️ Advanced Security Scan

- CodeQL static analysis
- Dependency security review
- Final security gate before deployment

### **Deployment Pipeline** (`.github/workflows/deploy.yml`)

The deploy workflow uses Vercel’s prebuilt flow for deterministic, single-build deployments and surfaces the deployed URL back to GitHub Environments and downstream jobs.

#### 1. 🚀 Deploy to Staging (develop branch)

- Uses Vercel CLI (pinned) with prebuilt flow:
  - `vercel pull --environment=preview`
  - `vercel build`
  - `vercel deploy --prebuilt`
- Sets the GitHub Environment URL for `staging` to the preview deployment URL.
- Exposes the preview URL as a job output for later steps.
- Triggers automatically on push to `develop`.

#### 2. 📝 Create Release PR (develop → main)

- Auto-creates PR from `develop` to `main`.
- Includes deployment checklist and the staging preview URL for QA.
- Requires manual review and approval.

#### 3. 🚀 Deploy to Production (main branch)

- Uses the same prebuilt flow with production settings:
  - `vercel pull --environment=production`
  - `vercel build`
  - `vercel deploy --prebuilt --prod`
- Sets the GitHub Environment URL for `production` to the live deployment URL.
- Exposes the production URL as a job output for monitoring/tests.

#### 4. 📊 Performance Monitoring

- Runs automated performance checks against the actual production deployment URL output by the previous job.
- Runs Lighthouse CI for performance metrics.

## 🛠️ Setup Instructions

### **1. Secrets and Environments**

Define Environments in GitHub → Settings → Environments:

- `staging` (optional protection rules/approvals)
- `production` (recommended protection/approvals)

Add these secrets (prefer environment-scoped secrets for least privilege):

```bash
# Required for both staging and production environments
VERCEL_TOKEN=your_vercel_token
VERCEL_ORG_ID=your_org_id
VERCEL_PROJECT_ID=your_project_id

# Optional
CODECOV_TOKEN=your_codecov_token
LHCI_GITHUB_APP_TOKEN=your_lighthouse_token
# Vercel CLI is pinned in the workflow; override only if needed
VERCEL_CLI_VERSION=32.7.1

# Optional (enables auto-created PRs)
PR_AUTOMATION_TOKEN=github_personal_access_token_with_repo_permissions
```

Note: The deployment URLs are discovered at deploy time via Vercel CLI and attached to the GitHub Environment, so a static `PRODUCTION_URL` secret is not required.

### **2. Branch Protection Rules**

````bash
# Main branch protection (production)
- Require pull request reviews (see Required Reviewers below)
- Require status checks to pass
- Require branches to be up to date
- Require review from Code Owners (recommended)
- Dismiss stale reviews when new commits are pushed (recommended)
- Restrict pushes to main branch (allow only admins/bots)

# Develop branch protection (staging)
- Require status checks to pass
- Allow force pushes for automation (optional)

#### Required Reviewers for Production PRs

Configure required reviewers so that release PRs from `develop → main` must be approved by humans before merge:

1. GitHub → Settings → Branches → Add rule for `main`.
2. Enable “Require a pull request before merging”.
3. Enable “Require approvals” and set the minimum (e.g., 1–2 approvals).
4. Enable “Require review from Code Owners” (recommended).
5. Optionally restrict who can dismiss reviews and who can push to `main`.

Optional: Define Code Owners so the right people are auto‑requested as reviewers. Create `.github/CODEOWNERS`:

```txt
# Example: require release managers for all changes
* @your-org/release-managers
````

You can scope owners per path to route reviews to specific teams.

````

### **3. Vercel Integration**

1. Connect your GitHub repo to Vercel.
2. Configure Project Environment Variables in Vercel (Preview vs. Production). Prefer using `NEXT_PUBLIC_*` only for values needed client‑side.
3. The workflow runs `vercel pull` to sync the correct env before building, ensuring parity with Vercel’s build-time configuration.

### **4. Deterministic Deploys and Safety**

- Prebuilt deploys: A single authoritative build is created in CI (`vercel build`) and deployed without rebuilding (`vercel deploy --prebuilt`).
- Permissions: Workflow defaults to `contents: read`; the PR job requests `pull-requests: write` only where needed.
- Concurrency: In-flight deploy runs are auto-cancelled per branch to avoid overlapping deployments.

### **5. Auto PRs and Release PRs**

- The repo appears to restrict GitHub Actions from creating PRs with the default `GITHUB_TOKEN`.
- To enable auto PRs from `feature/*` → `develop` and the auto release PR `develop → main`, create a classic PAT on a bot/user with `repo` scope and add it as `PR_AUTOMATION_TOKEN` (Actions secret). The workflows will use it; if absent, they skip PR creation gracefully and continue.

## 🔄 Workflow Examples

### **Feature Development**

```bash
# Create feature branch
git checkout -b feature/new-upload-ui

# Make changes, commit with conventional commits
git commit -m "feat: add drag-and-drop upload interface"

# Push triggers CI pipeline
git push origin feature/new-upload-ui

# Create PR to develop (manual or auto)
# CI runs security + quality checks
# Merge after approval
````

### **Release Process**

```bash
# Push to develop triggers:
1. ✅ CI Pipeline runs
2. 🚀 Deploy to staging
3. 📝 Auto-PR created (develop → main)
4. 👥 Manual review required
5. ✅ Merge to main
6. 🚀 Production deployment
7. 📊 Performance monitoring
```

## 🚨 Pipeline Failures

### **Security Failures**

- **High/Critical vulnerabilities** → Pipeline stops immediately
- **CodeQL security issues** → Deployment blocked
- **Dependency vulnerabilities** → Must be resolved

### **Quality Failures**

- **ESLint errors** → Fix code style issues
- **TypeScript errors** → Fix type issues
- **Test failures** → Fix failing tests
- **Low coverage** → Add more tests (minimum 50%)

### **Build Failures**

- **Compilation errors** → Fix build issues
- **Missing dependencies** → Update package.json
- **Environment issues** → Check configuration

## 📊 Monitoring & Reports

### **Available Reports**

- **Security**: GitHub Security tab
- **Code Quality**: PR checks and Actions
- **Test Coverage**: Codecov integration
- **Performance**: Lighthouse CI reports
- **Dependencies**: Dependabot alerts

### **Notifications**

- **Slack/Teams**: Configure webhook notifications
- **Email**: GitHub notification settings
- **Mobile**: GitHub mobile app notifications

## 🎯 Best Practices

### **Commit Messages**

Use conventional commits:

```bash
feat: add new feature
fix: resolve bug
docs: update documentation
style: code formatting
refactor: code restructuring
test: add tests
chore: maintenance tasks
```

### **Security**

- Never commit secrets or API keys
- Use environment variables for configuration
- Keep dependencies updated
- Review security scan results

### **Performance**

- Monitor Lighthouse scores
- Keep bundle sizes optimized
- Use performance budgets
- Regular performance testing

## 🆘 Troubleshooting

### **Common Issues**

1. **Security audit failures** → Update vulnerable dependencies
2. **Build failures** → Check Node.js version compatibility
3. **Test timeouts** → Optimize test performance
4. **Deployment failures** → Verify Vercel configuration

### **Debug Commands**

```bash
# Local testing
npm run lint
npm run build
npm test
npm audit

# Security testing
npx audit-ci
npm audit --audit-level high
```

---

**🎉 Your pipeline is now enterprise-ready with security-first automation!**
