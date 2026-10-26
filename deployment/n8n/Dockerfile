FROM n8nio/n8n:2.45.0
USER root
COPY integrations/n8n-nodes-cliptora /opt/cliptora-nodes
RUN chown -R node:node /opt/cliptora-nodes
ENV N8N_CUSTOM_EXTENSIONS=/opt/cliptora-nodes
USER node
