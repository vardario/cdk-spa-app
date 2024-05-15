#!/usr/bin/env node
import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import { CdkSpaDeploymentExample } from './cdk-spa-deployment-example.js';

const app = new cdk.App();
new CdkSpaDeploymentExample(app, 'CdkSpaDeploymentExample', {});
