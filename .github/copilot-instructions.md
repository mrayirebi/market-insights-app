# Copilot Instructions for Market Insights App

## Project Overview
This is an automated market insights application that provides data ingestion, AI summaries, alerts, and dashboards for financial market analysis.

## Key Guidelines

### Architecture & Design
- Follow clean architecture principles with clear separation of concerns
- Use dependency injection for better testability and maintainability
- Implement proper error handling and logging throughout the application
- Design for scalability to handle large volumes of market data

### Data Handling
- Ensure data integrity and validation for financial data
- Implement proper data sanitization for external market data sources
- Use appropriate data structures for time-series market data
- Handle edge cases like market holidays, missing data, and data delays

### AI/ML Components
- Document AI model assumptions and limitations
- Implement proper model versioning and deployment strategies
- Ensure reproducible results where possible
- Add proper monitoring for model performance and data drift

### Security & Compliance
- Never commit API keys, credentials, or sensitive configuration
- Implement proper authentication and authorization
- Follow financial data handling compliance requirements
- Use environment variables for sensitive configuration

### Code Quality
- Write comprehensive unit tests for business logic
- Include integration tests for external data sources
- Use meaningful commit messages following conventional commits
- Add inline documentation for complex financial calculations

### Performance
- Optimize for real-time data processing where needed
- Implement proper caching strategies for expensive operations
- Consider async/await patterns for I/O operations
- Monitor and profile performance-critical paths

### API Design
- Follow RESTful principles for API endpoints
- Use appropriate HTTP status codes
- Implement proper rate limiting for external APIs
- Version APIs to maintain backward compatibility

## Technology Stack Considerations
- Use type hints and static analysis tools
- Implement proper logging with structured formats
- Use configuration management for different environments
- Follow 12-factor app principles for deployment

## Testing Strategy
- Mock external data sources in tests
- Test with realistic market data scenarios
- Include tests for edge cases and error conditions
- Maintain test data that reflects real market conditions

## Documentation
- Keep README updated with setup and usage instructions
- Document API endpoints with examples
- Explain configuration options and environment variables
- Include troubleshooting guides for common issues