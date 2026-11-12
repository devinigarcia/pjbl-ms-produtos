import { describeRepositoryContract } from '../../support/repositoryContract';
import { inMemoryRepositories } from '../../support/testApp';

describeRepositoryContract('em memória', () => inMemoryRepositories());
