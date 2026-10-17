#!/usr/bin/env node
import { main } from '../src/tools/refresh-cli.js';
process.exitCode = await main();
