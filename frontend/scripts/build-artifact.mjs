import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildArtifact, runBuildCommand, verifyArtifact } from './artifact-identity.mjs'

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
try {
  if (process.argv[2] === '--verify' && process.argv.length === 4) {
    console.log(JSON.stringify(await verifyArtifact(source, process.argv[3])))
  } else if (process.argv.length === 2) {
    const result = await buildArtifact({
      source,
      prepare: env => runBuildCommand(process.execPath, ['scripts/prepare-pdf-assets.mjs'], source, env),
      compile: env => runBuildCommand(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], source, env),
    })
    console.log(JSON.stringify({ status: 'passed', artifact: result.artifact, ...(await verifyArtifact(source, result.artifact)) }))
  } else {
    throw new Error('Usage: node scripts/build-artifact.mjs [--verify ARTIFACT_DIR]')
  }
} catch (error) {
  // Our errors contain only fixed labels/public build status, never environment.
  console.error(`Artifact gate failed: ${error.message}`)
  process.exitCode = 1
}
